// Server-side push handler for the delta sync protocol.
//
// All writes for a given user execute inside a single transaction that
// SELECT … FOR UPDATEs the user_table row first, serialising concurrent pushes.
//
// Every mutation writes update-log rows stamped with the new mutateSeq.
// The push response carries per-scope deltas so the client can advance its
// syncedAtSeq without a separate pull round-trip.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  userTable,
  projTable,
  groupTable,
  todoTable,
  checkTable,
  projUpdateLog,
  groupUpdateLog,
  todoUpdateLog,
  checkUpdateLog,
} from "../db/schema";
import type {
  PushBody,
  ProjDelta,
  ProjListDelta,
  PlacementDelta,
  PushResponse,
} from "./types";
import { buildProjDelta, buildProjListDelta, buildPlacementDelta } from "./pull-handler";

// ─── Main entry point ────────────────────────────────────────────────────────

export async function applyPush(userId: string, body: PushBody): Promise<PushResponse> {
  const response = await db.transaction(async (tx) => {
    // Serialize all writes for this user.
    const [user] = await tx
      .select({ mutateSeq: userTable.mutateSeq, archiveSortSeq: userTable.archiveSortSeq, trashSortSeq: userTable.trashSortSeq, inboxSortSeq: userTable.inboxSortSeq })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .for("update");

    if (!user) throw new Error("user not found");

    const newSeq = user.mutateSeq + 1;
    let archiveSortSeq = user.archiveSortSeq;
    let trashSortSeq = user.trashSortSeq;
    let inboxSortSeq = user.inboxSortSeq;

    // Track which scopes were touched so we can compute deltas in the response.
    const touchedProjIds = new Set<string>();
    let touchedProjList = false;
    let touchedArchive = false;
    let touchedTrash = false;
    let touchedInbox = false;

    // ── projUpdates (before projsArrange so new projects exist when positioned) ─
    for (const pu of body.projUpdates ?? []) {
      await applyProjUpdate(tx, userId, pu, newSeq);
      touchedProjIds.add(pu.projId);
    }

    // ── projsArrange ────────────────────────────────────────────────────────
    if (body.projsArrange) {
      await applyProjsArrange(tx, userId, body.projsArrange, newSeq);
      touchedProjList = true;
    }

    // ── projDeletes ─────────────────────────────────────────────────────────
    for (const pd of body.projDeletes ?? []) {
      await applyProjDelete(tx, userId, pd, newSeq);
      touchedProjList = true;
    }

    // ── todoUpdates ─────────────────────────────────────────────────────────
    for (const tu of body.todoUpdates ?? []) {
      const projId = await applyTodoUpdate(tx, userId, tu, newSeq);
      if (projId) touchedProjIds.add(projId);
    }

    // ── todoDeletes ─────────────────────────────────────────────────────────
    for (const td of body.todoDeletes ?? []) {
      const projId = await applyTodoDelete(tx, userId, td, newSeq);
      if (projId) touchedProjIds.add(projId);
    }

    // ── archiveArrange ───────────────────────────────────────────────────────
    if (body.archiveArrange) {
      archiveSortSeq = await applyPlacementArrange(tx, userId, "archive", body.archiveArrange.slice, archiveSortSeq, newSeq);
      touchedArchive = true;
      touchedProjList = true;
    }

    // ── trashArrange ────────────────────────────────────────────────────────
    if (body.trashArrange) {
      trashSortSeq = await applyPlacementArrange(tx, userId, "trash", body.trashArrange.slice, trashSortSeq, newSeq);
      touchedTrash = true;
      touchedProjList = true;
    }

    // ── inboxArrange ────────────────────────────────────────────────────────
    if (body.inboxArrange) {
      inboxSortSeq = await applyInboxArrange(tx, userId, body.inboxArrange.slice, inboxSortSeq, newSeq);
      touchedInbox = true;
    }

    // Advance the user's counters.
    await tx
      .update(userTable)
      .set({ mutateSeq: newSeq, archiveSortSeq, trashSortSeq, inboxSortSeq })
      .where(eq(userTable.id, userId));

    return { newSeq, touchedProjIds, touchedProjList, touchedArchive, touchedTrash, touchedInbox };
  });

  // Compute deltas outside the transaction (reads only).
  const projDeltas: Record<string, ProjDelta> = {};
  const projSyncedAt: Record<string, number | undefined> = {};
  for (const pu of body.projUpdates ?? []) {
    projSyncedAt[pu.projId] = pu.syncedAtSeq;
  }
  for (const projId of response.touchedProjIds) {
    projDeltas[projId] = await buildProjDelta(userId, projId, projSyncedAt[projId]);
  }

  const projListSyncedAt = body.projsArrange
    ? undefined   // no syncedAtSeq in projsArrange; use 0 for full
    : undefined;

  const projListDelta = response.touchedProjList
    ? await buildProjListDelta(userId, projListSyncedAt)
    : undefined;

  const archiveDelta = response.touchedArchive
    ? await buildPlacementDelta(userId, "archive")
    : undefined;

  const trashDelta = response.touchedTrash
    ? await buildPlacementDelta(userId, "trash")
    : undefined;

  const inboxDelta = response.touchedInbox
    ? await buildPlacementDelta(userId, "inbox")
    : undefined;

  return {
    ok: true,
    newSeq: response.newSeq,
    ...(Object.keys(projDeltas).length > 0 && { projDeltas }),
    ...(projListDelta && { projListDelta }),
    ...(archiveDelta && { archiveDelta }),
    ...(trashDelta && { trashDelta }),
    ...(inboxDelta && { inboxDelta }),
  };
}

// ─── Tx type helper ──────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// proj.placement ("list"|"archive"|"trash") → todo.placement ("project"|"archive"|"trash")
const projToTodoPlacement = (p: "list" | "archive" | "trash"): "project" | "archive" | "trash" =>
  p === "list" ? "project" : p;

// ─── projsArrange ────────────────────────────────────────────────────────────

async function applyProjsArrange(
  tx: Tx,
  userId: string,
  arrange: NonNullable<PushBody["projsArrange"]>,
  seq: number,
): Promise<void> {
  for (let i = 0; i < arrange.orderProjs.length; i++) {
    const entry = arrange.orderProjs[i];
    const idx = entry.startAtIndex ?? i;

    // A project appearing in the list order that wasn't in the list is a restore
    // from archive/trash; its rows kept placement="project" the whole time, so
    // flipping the proj back to "list" is all that's needed.
    await tx
      .update(projTable)
      .set({ sortKey: idx, placement: "list" })
      .where(and(eq(projTable.id, entry.projId), eq(projTable.userId, userId)));
    await tx.insert(projUpdateLog).values({
      userId,
      projId: entry.projId,
      placement: "list",
      update: "position",
      createdAtSeq: seq,
    });
  }
}

// ─── projUpdate ──────────────────────────────────────────────────────────────

async function applyProjUpdate(
  tx: Tx,
  userId: string,
  pu: NonNullable<PushBody["projUpdates"]>[number],
  seq: number,
): Promise<void> {
  const { projId } = pu;

  // Verify ownership, or create if new.
  let [proj] = await tx
    .select({ id: projTable.id, placement: projTable.placement })
    .from(projTable)
    .where(and(eq(projTable.id, projId), eq(projTable.userId, userId)));

  let isNew = false;
  if (!proj) {
    // New project — INSERT it. Require at least a name to distinguish intentional
    // creates from stale pushes referencing a deleted project.
    if (pu.name === undefined && pu.note === undefined) return;
    await tx.insert(projTable).values({
      id: projId,
      userId,
      placement: "list",
      sortKey: 0,
      name: pu.name ?? "",
      note: pu.note ?? "",
    });
    await tx.insert(projUpdateLog).values({
      userId,
      projId,
      placement: "list",
      update: "enter",
      createdAtSeq: seq,
    });
    proj = { id: projId, placement: "list" };
    isNew = true;
  }

  // Field edits on the project itself (skip if we just inserted with those values).
  const projPatch: Record<string, unknown> = {};
  if (!isNew) {
    if (pu.name !== undefined) projPatch.name = pu.name;
    if (pu.note !== undefined) projPatch.note = pu.note;
  }

  if (Object.keys(projPatch).length > 0) {
    await tx.update(projTable).set(projPatch).where(eq(projTable.id, projId));
    for (const field of Object.keys(projPatch) as Array<"name" | "note">) {
      await tx.insert(projUpdateLog).values({
        userId,
        projId,
        placement: proj.placement,
        update: field,
        createdAtSeq: seq,
      });
    }
  }

  const todoPlacement = projToTodoPlacement(proj.placement);

  // Delete rows.
  for (const [rowId, kind] of Object.entries(pu.deleteRows ?? {})) {
    if (kind === "todo") {
      await deleteTodo(tx, userId, rowId, projId, todoPlacement, seq);
    } else {
      await deleteGroup(tx, userId, rowId, projId, proj.placement, seq);
    }
  }

  // Move rows out (todos → inbox, groups → discard).
  for (const [rowId, kind] of Object.entries(pu.moveOutRows ?? {})) {
    if (kind === "todo") {
      await moveTodoToInbox(tx, userId, rowId, projId, seq);
    } else {
      await deleteGroup(tx, userId, rowId, projId, proj.placement, seq);
    }
  }

  // Row ordering / creation (orderRows describes the new desired order and
  // INSERTs createHere rows). Runs BEFORE the field/check edits below so a row
  // created in this same push exists before applyTodoCheckOps writes its checks —
  // check_update_log.todoId is an FK to the todo row.
  if (pu.orderRows && pu.orderRows.length > 0) {
    await applyRowOrder(tx, userId, projId, pu.orderRows, pu.editRows ?? {}, seq);
  }

  // Field edits for rows (todos and groups).
  for (const [rowId, edit] of Object.entries(pu.editRows ?? {})) {
    if (edit.kind === "todo") {
      await applyTodoEdit(tx, userId, rowId, projId, todoPlacement, edit, seq);
      await applyTodoCheckOps(tx, userId, rowId, todoPlacement, projId, edit.editChecks, edit.orderChecks, edit.deleteChecks, seq);
    } else {
      await applyGroupEdit(tx, userId, rowId, projId, edit, seq);
    }
  }
}

// ─── Row ordering ─────────────────────────────────────────────────────────────

async function applyRowOrder(
  tx: Tx,
  userId: string,
  projId: string,
  orderRows: NonNullable<NonNullable<PushBody["projUpdates"]>[number]["orderRows"]>,
  editRows: NonNullable<NonNullable<PushBody["projUpdates"]>[number]["editRows"]>,
  seq: number,
): Promise<void> {
  for (let i = 0; i < orderRows.length; i++) {
    const entry = orderRows[i];
    const idx = entry.startAtIndex ?? i;

    if (entry.kind === "todo") {
      if (entry.createHere) {
        // Data must be in editRows.
        const data = editRows[entry.rowId];
        if (!data || data.kind !== "todo") continue;
        await tx.insert(todoTable).values({
          id: entry.rowId,
          userId,
          placement: "project",
          projId,
          sortKey: idx,
          title: data.title ?? "",
          note: data.note ?? "",
          done: data.done ?? false,
          planned: data.planned ?? null,
        });
        await tx.insert(todoUpdateLog).values({
          userId,
          todoId: entry.rowId,
          placement: "project",
          projId,
          update: "enter",
          createdAtSeq: seq,
        });
      } else {
        await tx
          .update(todoTable)
          .set({ sortKey: idx, projId, placement: "project" })
          .where(and(eq(todoTable.id, entry.rowId), eq(todoTable.userId, userId)));
        if (entry.moveHere) {
          await tx.insert(todoUpdateLog).values({
            userId,
            todoId: entry.rowId,
            placement: "project",
            projId,
            update: "enter",
            createdAtSeq: seq,
          });
        } else {
          await tx.insert(todoUpdateLog).values({
            userId,
            todoId: entry.rowId,
            placement: "project",
            projId,
            update: "position",
            createdAtSeq: seq,
          });
        }
      }
    } else {
      // group
      if (entry.createHere) {
        const data = editRows[entry.rowId];
        if (!data || data.kind !== "group") continue;
        await tx.insert(groupTable).values({
          id: entry.rowId,
          projId,
          label: data.label ?? "",
          sortKey: idx,
        });
        await tx.insert(groupUpdateLog).values({
          userId,
          groupId: entry.rowId,
          projId,
          update: "enter",
          createdAtSeq: seq,
        });
      } else {
        await tx
          .update(groupTable)
          .set({ sortKey: idx, projId })
          .where(eq(groupTable.id, entry.rowId));
        if (entry.moveHere) {
          await tx.insert(groupUpdateLog).values({
            userId,
            groupId: entry.rowId,
            projId,
            update: "enter",
            createdAtSeq: seq,
          });
        } else {
          await tx.insert(groupUpdateLog).values({
            userId,
            groupId: entry.rowId,
            projId,
            update: "position",
            createdAtSeq: seq,
          });
        }
      }
    }
  }
}

// ─── projDelete ───────────────────────────────────────────────────────────────

async function applyProjDelete(
  tx: Tx,
  userId: string,
  pd: NonNullable<PushBody["projDeletes"]>[number],
  seq: number,
): Promise<void> {
  const [proj] = await tx
    .select({ placement: projTable.placement })
    .from(projTable)
    .where(and(eq(projTable.id, pd.projId), eq(projTable.userId, userId)));
  if (!proj) return;

  const todos = await tx
    .select({ id: todoTable.id, placement: todoTable.placement, projId: todoTable.projId })
    .from(todoTable)
    .where(and(eq(todoTable.projId, pd.projId), eq(todoTable.userId, userId)));

  const todoIds = todos.map((t) => t.id);
  if (todoIds.length > 0) {
    const checks = await tx
      .select({ id: checkTable.id, todoId: checkTable.todoId })
      .from(checkTable)
      .where(inArray(checkTable.todoId, todoIds));
    for (const c of checks) {
      const [todo] = todos.filter((t) => t.id === c.todoId);
      if (todo) {
        await tx.insert(checkUpdateLog).values({
          userId,
          checkId: c.id,
          todoId: todo.id,
          placement: todo.placement,
          projId: todo.projId,
          update: "exit",
          createdAtSeq: seq,
        });
      }
    }
    await tx.delete(checkTable).where(inArray(checkTable.todoId, todoIds));

    for (const t of todos) {
      await tx.insert(todoUpdateLog).values({
        userId,
        todoId: t.id,
        placement: t.placement,
        projId: t.projId,
        update: "exit",
        createdAtSeq: seq,
      });
    }
    await tx.delete(todoTable).where(inArray(todoTable.id, todoIds));
  }

  const groups = await tx
    .select({ id: groupTable.id })
    .from(groupTable)
    .where(eq(groupTable.projId, pd.projId));
  for (const g of groups) {
    await tx.insert(groupUpdateLog).values({
      userId,
      groupId: g.id,
      projId: pd.projId,
      update: "exit",
      createdAtSeq: seq,
    });
  }
  if (groups.length > 0) {
    await tx.delete(groupTable).where(eq(groupTable.projId, pd.projId));
  }

  await tx.insert(projUpdateLog).values({
    userId,
    projId: pd.projId,
    placement: proj.placement,
    update: "exit",
    createdAtSeq: seq,
  });
  await tx
    .delete(projTable)
    .where(and(eq(projTable.id, pd.projId), eq(projTable.userId, userId)));
}

// ─── todoUpdate (isolated) ───────────────────────────────────────────────────

async function applyTodoUpdate(
  tx: Tx,
  userId: string,
  tu: NonNullable<PushBody["todoUpdates"]>[number],
  seq: number,
): Promise<string | null> {
  const [todo] = await tx
    .select({ projId: todoTable.projId, placement: todoTable.placement })
    .from(todoTable)
    .where(and(eq(todoTable.id, tu.todoId), eq(todoTable.userId, userId)));
  if (!todo) return null;

  await applyTodoEdit(tx, userId, tu.todoId, todo.projId ?? "", todo.placement, tu, seq);

  await applyTodoCheckOps(tx, userId, tu.todoId, todo.placement, todo.projId ?? null, tu.editChecks, tu.orderChecks, tu.deleteChecks, seq);

  return todo.projId ?? null;
}

// ─── todoDelete ───────────────────────────────────────────────────────────────

async function applyTodoDelete(
  tx: Tx,
  userId: string,
  td: NonNullable<PushBody["todoDeletes"]>[number],
  seq: number,
): Promise<string | null> {
  const [todo] = await tx
    .select({ projId: todoTable.projId, placement: todoTable.placement })
    .from(todoTable)
    .where(and(eq(todoTable.id, td.todoId), eq(todoTable.userId, userId)));
  if (!todo) return null;

  const projId = todo.projId;
  await deleteTodo(tx, userId, td.todoId, projId ?? "", todo.placement, seq);
  return projId ?? null;
}

// ─── Placement arrange (archive/trash) ──────────────────────────────────────

async function applyPlacementArrange(
  tx: Tx,
  userId: string,
  placement: "archive" | "trash",
  slice: NonNullable<PushBody["archiveArrange"]>["slice"],
  currentSortSeq: number,
  seq: number,
): Promise<number> {
  let sortSeq = currentSortSeq;
  for (const entry of slice) {
    if (entry.createHere) {
      sortSeq++;
      if (entry.kind === "proj") {
        const [proj] = await tx
          .select({ placement: projTable.placement })
          .from(projTable)
          .where(and(eq(projTable.id, entry.projId), eq(projTable.userId, userId)));
        if (!proj) continue;

        // Exit from old placement, enter new. The project's rows keep
        // placement="project" and just ride along.
        await tx.insert(projUpdateLog).values({
          userId,
          projId: entry.projId,
          placement: proj.placement,
          update: "exit",
          createdAtSeq: seq,
        });
        await tx
          .update(projTable)
          .set({ placement, sortKey: sortSeq })
          .where(eq(projTable.id, entry.projId));
        await tx.insert(projUpdateLog).values({
          userId,
          projId: entry.projId,
          placement,
          update: "enter",
          createdAtSeq: seq,
        });
      } else {
        // todo
        const [todo] = await tx
          .select({ projId: todoTable.projId, placement: todoTable.placement })
          .from(todoTable)
          .where(and(eq(todoTable.id, entry.todoId), eq(todoTable.userId, userId)));
        if (!todo) {
          // Brand-new todo created directly in archive/trash (never lived in a
          // project) — INSERT it with the data carried in the slice entry. Its
          // originating project, if any, is the associateProjId.
          await createPlacementTodo(tx, userId, entry.todoId, placement, entry.associateProjId ?? null, sortSeq, entry.data, seq);
          continue;
        }

        await tx.insert(todoUpdateLog).values({
          userId,
          todoId: entry.todoId,
          placement: todo.placement,
          projId: todo.projId,
          update: "exit",
          createdAtSeq: seq,
        });
        await tx
          .update(todoTable)
          .set({
            placement,
            sortKey: sortSeq,
            projId: entry.associateProjId ?? todo.projId,
          })
          .where(eq(todoTable.id, entry.todoId));
        await tx.insert(todoUpdateLog).values({
          userId,
          todoId: entry.todoId,
          placement,
          projId: entry.associateProjId ?? todo.projId,
          update: "enter",
          createdAtSeq: seq,
        });
      }
    }
  }
  return sortSeq;
}

// ─── inboxArrange ────────────────────────────────────────────────────────────

async function applyInboxArrange(
  tx: Tx,
  userId: string,
  slice: NonNullable<PushBody["inboxArrange"]>["slice"],
  currentSortSeq: number,
  seq: number,
): Promise<number> {
  let sortSeq = currentSortSeq;
  for (const entry of slice) {
    if (entry.createHere) {
      sortSeq++;
      const [todo] = await tx
        .select({ projId: todoTable.projId, placement: todoTable.placement })
        .from(todoTable)
        .where(and(eq(todoTable.id, entry.todoId), eq(todoTable.userId, userId)));
      if (!todo) {
        // Brand-new todo created directly in the inbox: INSERT it (and its
        // checks) with the data carried in the slice entry.
        await createPlacementTodo(tx, userId, entry.todoId, "inbox", null, sortSeq, entry.data, seq);
        continue;
      }

      await tx.insert(todoUpdateLog).values({
        userId,
        todoId: entry.todoId,
        placement: todo.placement,
        projId: todo.projId,
        update: "exit",
        createdAtSeq: seq,
      });
      await tx
        .update(todoTable)
        .set({ placement: "inbox", sortKey: sortSeq, projId: null })
        .where(eq(todoTable.id, entry.todoId));
      await tx.insert(todoUpdateLog).values({
        userId,
        todoId: entry.todoId,
        placement: "inbox",
        projId: null,
        update: "enter",
        createdAtSeq: seq,
      });
    }
  }
  return sortSeq;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// INSERT a brand-new todo (and its checks, in array order) directly into a
// placement view (inbox/archive/trash), for the createHere paths where the todo
// never lived in a project — e.g. the sign-up migration of a guest's placement
// todos. `projId` is the todo's originating project (associateProjId) or null.
async function createPlacementTodo(
  tx: Tx,
  userId: string,
  todoId: string,
  placement: "inbox" | "archive" | "trash",
  projId: string | null,
  sortKey: number,
  data:
    | { title?: string; note?: string; done?: boolean; planned?: string | null; checks?: { id: string; content: string; ticked: boolean }[] }
    | undefined,
  seq: number,
): Promise<void> {
  await tx.insert(todoTable).values({
    id: todoId,
    userId,
    placement,
    projId,
    sortKey,
    title: data?.title ?? "",
    note: data?.note ?? "",
    done: data?.done ?? false,
    planned: data?.planned ?? null,
  });
  await tx.insert(todoUpdateLog).values({
    userId,
    todoId,
    placement,
    projId,
    update: "enter",
    createdAtSeq: seq,
  });
  const checks = data?.checks ?? [];
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    await tx
      .insert(checkTable)
      .values({ id: c.id, todoId, sortKey: i, content: c.content, ticked: c.ticked })
      .onConflictDoNothing();
    await tx.insert(checkUpdateLog).values({
      userId,
      checkId: c.id,
      todoId,
      placement,
      projId,
      update: "enter",
      createdAtSeq: seq,
    });
  }
}

async function deleteTodo(
  tx: Tx,
  userId: string,
  todoId: string,
  projId: string,
  placement: string,
  seq: number,
): Promise<void> {
  const checks = await tx
    .select({ id: checkTable.id })
    .from(checkTable)
    .where(eq(checkTable.todoId, todoId));
  for (const c of checks) {
    await tx.insert(checkUpdateLog).values({
      userId,
      checkId: c.id,
      todoId,
      placement: placement as "project" | "inbox" | "archive" | "trash",
      projId: projId || null,
      update: "exit",
      createdAtSeq: seq,
    });
  }
  if (checks.length > 0) {
    await tx.delete(checkTable).where(inArray(checkTable.id, checks.map((c) => c.id)));
  }
  await tx.insert(todoUpdateLog).values({
    userId,
    todoId,
    placement: placement as "project" | "inbox" | "archive" | "trash",
    projId: projId || null,
    update: "exit",
    createdAtSeq: seq,
  });
  await tx.delete(todoTable).where(and(eq(todoTable.id, todoId), eq(todoTable.userId, userId)));
}

async function deleteGroup(
  tx: Tx,
  userId: string,
  groupId: string,
  projId: string,
  placement: string,
  seq: number,
): Promise<void> {
  void placement; // groups don't have placements
  await tx.insert(groupUpdateLog).values({
    userId,
    groupId,
    projId,
    update: "exit",
    createdAtSeq: seq,
  });
  await tx.delete(groupTable).where(eq(groupTable.id, groupId));
}

async function moveTodoToInbox(
  tx: Tx,
  userId: string,
  todoId: string,
  projId: string,
  seq: number,
): Promise<void> {
  const [todo] = await tx
    .select({ placement: todoTable.placement, sortKey: todoTable.sortKey })
    .from(todoTable)
    .where(and(eq(todoTable.id, todoId), eq(todoTable.userId, userId)));
  if (!todo) return;

  await tx.insert(todoUpdateLog).values({
    userId,
    todoId,
    placement: todo.placement,
    projId,
    update: "exit",
    createdAtSeq: seq,
  });

  // sortKey for inbox will be assigned when inboxArrange is processed, or use 0 for now.
  await tx
    .update(todoTable)
    .set({ placement: "inbox", projId: null })
    .where(eq(todoTable.id, todoId));

  await tx.insert(todoUpdateLog).values({
    userId,
    todoId,
    placement: "inbox",
    projId: null,
    update: "enter",
    createdAtSeq: seq,
  });
}

type TodEditShape = {
  title?: string;
  note?: string;
  done?: boolean;
  planned?: string | null;
};

async function applyTodoEdit(
  tx: Tx,
  userId: string,
  todoId: string,
  projId: string,
  placement: string,
  data: TodEditShape,
  seq: number,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  const logFields: Array<"title" | "note" | "done" | "planned"> = [];
  if (data.title !== undefined) { patch.title = data.title; logFields.push("title"); }
  if (data.note !== undefined) { patch.note = data.note; logFields.push("note"); }
  if (data.done !== undefined) { patch.done = data.done; logFields.push("done"); }
  if (data.planned !== undefined) { patch.planned = data.planned; logFields.push("planned"); }
  if (Object.keys(patch).length === 0) return;

  await tx
    .update(todoTable)
    .set(patch)
    .where(and(eq(todoTable.id, todoId), eq(todoTable.userId, userId)));

  for (const field of logFields) {
    await tx.insert(todoUpdateLog).values({
      userId,
      todoId,
      placement: placement as "project" | "inbox" | "archive" | "trash",
      projId: projId || null,
      update: field,
      createdAtSeq: seq,
    });
  }
}

async function applyGroupEdit(
  tx: Tx,
  userId: string,
  groupId: string,
  projId: string,
  data: { kind: "group"; label?: string; syncedAtSeq?: number },
  seq: number,
): Promise<void> {
  if (data.label === undefined) return;
  await tx.update(groupTable).set({ label: data.label }).where(eq(groupTable.id, groupId));
  await tx.insert(groupUpdateLog).values({
    userId,
    groupId,
    projId,
    update: "label",
    createdAtSeq: seq,
  });
}

// Handles all check mutations for a todo in one pass:
//   - INSERTs new checks (createHere in orderChecks + data from editChecks)
//   - UPDATEs existing check fields (editChecks entries without createHere)
//   - DELETEs checks absent from orderChecks (orderChecks is always the complete desired list)
//   - Sets sortKeys for all listed checks
async function applyTodoCheckOps(
  tx: Tx,
  userId: string,
  todoId: string,
  placement: string,
  projId: string | null,
  editChecks: Record<string, { content?: string; ticked?: boolean }> | undefined | null,
  orderChecks: { checkId: string; startAtIndex?: number; createHere?: boolean }[] | undefined | null,
  deleteChecks: string[] | undefined | null,
  seq: number,
): Promise<void> {
  const pl = placement as "project" | "inbox" | "archive" | "trash";

  // Hard-delete explicit deleteChecks.
  if (deleteChecks && deleteChecks.length > 0) {
    for (const checkId of deleteChecks) {
      await tx.insert(checkUpdateLog).values({ userId, checkId, todoId, placement: pl, projId, update: "exit", createdAtSeq: seq });
    }
    await tx.delete(checkTable).where(inArray(checkTable.id, deleteChecks));
  }

  const createHereIds = new Set(
    (orderChecks ?? []).filter((e) => e.createHere).map((e) => e.checkId),
  );

  // Process editChecks: INSERT new checks, UPDATE existing ones.
  for (const [checkId, checkData] of Object.entries(editChecks ?? {})) {
    if (createHereIds.has(checkId)) {
      await tx
        .insert(checkTable)
        .values({ id: checkId, todoId, sortKey: 0, content: checkData.content ?? "", ticked: checkData.ticked ?? false })
        .onConflictDoNothing();
      await tx.insert(checkUpdateLog).values({ userId, checkId, todoId, placement: pl, projId, update: "enter", createdAtSeq: seq });
    } else {
      const patch: Record<string, unknown> = {};
      if (checkData.content !== undefined) patch.content = checkData.content;
      if (checkData.ticked !== undefined) patch.ticked = checkData.ticked;
      if (Object.keys(patch).length === 0) continue;
      await tx.update(checkTable).set(patch).where(eq(checkTable.id, checkId));
      for (const field of Object.keys(patch) as Array<"content" | "ticked">) {
        await tx.insert(checkUpdateLog).values({ userId, checkId, todoId, placement: pl, projId, update: field, createdAtSeq: seq });
      }
    }
  }

  if (!orderChecks) return;

  // orderChecks is the complete desired check list — delete any checks not in it.
  const orderedIds = new Set(orderChecks.map((e) => e.checkId));
  const existingChecks = await tx
    .select({ id: checkTable.id })
    .from(checkTable)
    .where(eq(checkTable.todoId, todoId));

  const toDelete = existingChecks.filter((c) => !orderedIds.has(c.id));
  for (const c of toDelete) {
    await tx.insert(checkUpdateLog).values({ userId, checkId: c.id, todoId, placement: pl, projId, update: "exit", createdAtSeq: seq });
  }
  if (toDelete.length > 0) {
    await tx.delete(checkTable).where(inArray(checkTable.id, toDelete.map((c) => c.id)));
  }

  // Set sortKeys for all listed checks.
  for (let i = 0; i < orderChecks.length; i++) {
    const entry = orderChecks[i];
    const idx = entry.startAtIndex ?? i;
    await tx.update(checkTable).set({ sortKey: idx }).where(eq(checkTable.id, entry.checkId));
    if (!entry.createHere) {
      await tx.insert(checkUpdateLog).values({ userId, checkId: entry.checkId, todoId, placement: pl, projId, update: "position", createdAtSeq: seq });
    }
  }
}
