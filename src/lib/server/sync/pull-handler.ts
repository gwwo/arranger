// Server-side pull / delta computation.
//
// Delta algorithm (per schema.ts comments):
//   1. Query update logs for entries since syncedAtSeq.
//   2. Classify entities as entered, exited, or field-changed.
//   3. Fetch current state for entered/changed entities.
//   4. Return the delta.
//
// For placement views (inbox / archive / trash), we do a simple full fetch
// (no delta) because these lists are typically small and rarely polled.

import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
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
} from "../db/schema";
import type {
  ProjDelta,
  ProjListDelta,
  PlacementDelta,
  PullRow,
  ChangedRow,
  ProjListEntry,
} from "./types";

// ─── Project content delta ───────────────────────────────────────────────────

export async function buildProjDelta(
  userId: string,
  projId: string,
  syncedAtSeq: number | undefined,
): Promise<ProjDelta> {
  // Get current seq.
  const [user] = await db
    .select({ mutateSeq: userTable.mutateSeq })
    .from(userTable)
    .where(eq(userTable.id, userId));
  const newSeq = user?.mutateSeq ?? 0;

  if (syncedAtSeq === undefined) {
    // Full bootstrap.
    return fullProjFetch(userId, projId, newSeq);
  }

  // ── Find entered/exited todos ──────────────────────────────────────────────
  const todoEnterExitLogs = await db
    .select({
      todoId: todoUpdateLog.todoId,
      update: todoUpdateLog.update,
      minSeq: sql<number>`MIN(${todoUpdateLog.createdAtSeq})`,
      minEnterSeq: sql<number>`MIN(CASE WHEN ${todoUpdateLog.update} = 'enter' THEN ${todoUpdateLog.createdAtSeq} END)`,
      minExitSeq: sql<number>`MIN(CASE WHEN ${todoUpdateLog.update} = 'exit' THEN ${todoUpdateLog.createdAtSeq} END)`,
    })
    .from(todoUpdateLog)
    .where(
      and(
        eq(todoUpdateLog.userId, userId),
        eq(todoUpdateLog.projId, projId),
        gt(todoUpdateLog.createdAtSeq, syncedAtSeq),
        inArray(todoUpdateLog.update, ["enter", "exit"]),
      ),
    )
    .groupBy(todoUpdateLog.todoId, todoUpdateLog.update);

  // Aggregate per todoId.
  const todoFirstEvent = new Map<string, { minSeq: number; minEnterSeq: number | null; minExitSeq: number | null }>();
  for (const row of todoEnterExitLogs) {
    const existing = todoFirstEvent.get(row.todoId);
    if (!existing) {
      todoFirstEvent.set(row.todoId, {
        minSeq: row.minSeq,
        minEnterSeq: row.update === "enter" ? row.minSeq : null,
        minExitSeq: row.update === "exit" ? row.minSeq : null,
      });
    } else {
      if (row.update === "enter") existing.minEnterSeq = row.minSeq;
      if (row.update === "exit") existing.minExitSeq = row.minSeq;
      existing.minSeq = Math.min(existing.minSeq, row.minSeq);
    }
  }

  // Similarly for groups.
  const groupEnterExitLogs = await db
    .select({
      groupId: groupUpdateLog.groupId,
      update: groupUpdateLog.update,
      minSeq: sql<number>`MIN(${groupUpdateLog.createdAtSeq})`,
    })
    .from(groupUpdateLog)
    .where(
      and(
        eq(groupUpdateLog.userId, userId),
        eq(groupUpdateLog.projId, projId),
        gt(groupUpdateLog.createdAtSeq, syncedAtSeq),
        inArray(groupUpdateLog.update, ["enter", "exit"]),
      ),
    )
    .groupBy(groupUpdateLog.groupId, groupUpdateLog.update);

  const groupFirstEvent = new Map<string, { minEnterSeq: number | null; minExitSeq: number | null }>();
  for (const row of groupEnterExitLogs) {
    const existing = groupFirstEvent.get(row.groupId);
    if (!existing) {
      groupFirstEvent.set(row.groupId, {
        minEnterSeq: row.update === "enter" ? row.minSeq : null,
        minExitSeq: row.update === "exit" ? row.minSeq : null,
      });
    } else {
      if (row.update === "enter") existing.minEnterSeq = row.minSeq;
      if (row.update === "exit") existing.minExitSeq = row.minSeq;
    }
  }

  // Find which todos are currently present in this project (placement="project" only —
  // trashed/archived todos keep their projId as an association but are not "in" the project).
  const presentTodos = await db
    .select({ id: todoTable.id })
    .from(todoTable)
    .where(and(
      eq(todoTable.projId, projId),
      eq(todoTable.userId, userId),
      eq(todoTable.placement, "project"),
    ));
  const presentTodoIds = new Set(presentTodos.map((t) => t.id));

  const presentGroups = await db
    .select({ id: groupTable.id })
    .from(groupTable)
    .where(eq(groupTable.projId, projId));
  const presentGroupIds = new Set(presentGroups.map((g) => g.id));

  // Classify todos.
  const trulyEnteredTodoIds = new Set<string>();
  const trulyExitedTodoIds = new Set<string>();

  for (const [id, evt] of todoFirstEvent) {
    const firstIsEnter = evt.minEnterSeq !== null && (evt.minExitSeq === null || evt.minEnterSeq <= evt.minExitSeq);
    if (firstIsEnter) {
      if (presentTodoIds.has(id)) {
        trulyEnteredTodoIds.add(id); // entered (and still here)
      }
      // else: entered then exited — ignore
    } else {
      if (!presentTodoIds.has(id)) {
        trulyExitedTodoIds.add(id); // truly exited
      } else {
        trulyEnteredTodoIds.add(id); // exited then re-entered — treat as entered
      }
    }
  }

  // Classify groups.
  const trulyEnteredGroupIds = new Set<string>();
  const trulyExitedGroupIds = new Set<string>();

  for (const [id, evt] of groupFirstEvent) {
    const firstIsEnter = evt.minEnterSeq !== null && (evt.minExitSeq === null || evt.minEnterSeq <= evt.minExitSeq);
    if (firstIsEnter) {
      if (presentGroupIds.has(id)) trulyEnteredGroupIds.add(id);
    } else {
      if (!presentGroupIds.has(id)) trulyExitedGroupIds.add(id);
      else trulyEnteredGroupIds.add(id);
    }
  }

  // ── Find field changes for known rows ────────────────────────────────────
  const changedTodoLogs = trulyEnteredTodoIds.size > 0
    ? await db
        .select({ todoId: todoUpdateLog.todoId, update: todoUpdateLog.update })
        .from(todoUpdateLog)
        .where(
          and(
            eq(todoUpdateLog.userId, userId),
            eq(todoUpdateLog.projId, projId),
            gt(todoUpdateLog.createdAtSeq, syncedAtSeq),
            inArray(todoUpdateLog.update, ["title", "note", "done", "planned"]),
          ),
        )
        .groupBy(todoUpdateLog.todoId, todoUpdateLog.update)
    : await db
        .select({ todoId: todoUpdateLog.todoId, update: todoUpdateLog.update })
        .from(todoUpdateLog)
        .where(
          and(
            eq(todoUpdateLog.userId, userId),
            eq(todoUpdateLog.projId, projId),
            gt(todoUpdateLog.createdAtSeq, syncedAtSeq),
            inArray(todoUpdateLog.update, ["title", "note", "done", "planned"]),
          ),
        )
        .groupBy(todoUpdateLog.todoId, todoUpdateLog.update);

  const changedTodoFields = new Map<string, Set<string>>();
  for (const row of changedTodoLogs) {
    if (trulyEnteredTodoIds.has(row.todoId)) continue; // will be sent as full enter
    if (!presentTodoIds.has(row.todoId)) continue; // already exited
    const fields = changedTodoFields.get(row.todoId) ?? new Set();
    fields.add(row.update);
    changedTodoFields.set(row.todoId, fields);
  }

  const changedGroupLogs = await db
    .select({ groupId: groupUpdateLog.groupId, update: groupUpdateLog.update })
    .from(groupUpdateLog)
    .where(
      and(
        eq(groupUpdateLog.userId, userId),
        eq(groupUpdateLog.projId, projId),
        gt(groupUpdateLog.createdAtSeq, syncedAtSeq),
        inArray(groupUpdateLog.update, ["label"]),
      ),
    )
    .groupBy(groupUpdateLog.groupId, groupUpdateLog.update);

  const changedGroupFields = new Map<string, Set<string>>();
  for (const row of changedGroupLogs) {
    if (trulyEnteredGroupIds.has(row.groupId)) continue;
    if (!presentGroupIds.has(row.groupId)) continue;
    const fields = changedGroupFields.get(row.groupId) ?? new Set();
    fields.add(row.update);
    changedGroupFields.set(row.groupId, fields);
  }

  // ── Fetch current state for entered/changed rows ──────────────────────────
  const enteredTodoIds = [...trulyEnteredTodoIds];
  const changedTodoIds = [...changedTodoFields.keys()];
  const allFetchTodoIds = [...new Set([...enteredTodoIds, ...changedTodoIds])];

  const fetchedTodos = allFetchTodoIds.length > 0
    ? await db
        .select()
        .from(todoTable)
        .where(inArray(todoTable.id, allFetchTodoIds))
    : [];

  const enteredGroupIds = [...trulyEnteredGroupIds];
  const changedGroupIds = [...changedGroupFields.keys()];
  const allFetchGroupIds = [...new Set([...enteredGroupIds, ...changedGroupIds])];

  const fetchedGroups = allFetchGroupIds.length > 0
    ? await db
        .select()
        .from(groupTable)
        .where(inArray(groupTable.id, allFetchGroupIds))
    : [];

  // Fetch checks for entered todos.
  const fetchedChecks = enteredTodoIds.length > 0
    ? await db
        .select()
        .from(checkTable)
        .where(inArray(checkTable.todoId, enteredTodoIds))
        .orderBy(asc(checkTable.sortKey))
    : [];
  const checksByTodo = new Map<string, typeof fetchedChecks>();
  for (const c of fetchedChecks) {
    const list = checksByTodo.get(c.todoId) ?? [];
    list.push(c);
    checksByTodo.set(c.todoId, list);
  }

  // Build entered rows.
  const enteredRows: PullRow[] = [];
  for (const t of fetchedTodos) {
    if (!trulyEnteredTodoIds.has(t.id)) continue;
    enteredRows.push({
      kind: "todo",
      id: t.id,
      title: t.title ?? "",
      note: t.note ?? "",
      done: t.done,
      planned: t.planned,
      sortKey: t.sortKey,
      checks: (checksByTodo.get(t.id) ?? []).map((c) => ({
        id: c.id,
        content: c.content,
        ticked: c.ticked,
        sortKey: c.sortKey,
      })),
    });
  }
  for (const g of fetchedGroups) {
    if (!trulyEnteredGroupIds.has(g.id)) continue;
    enteredRows.push({
      kind: "group",
      id: g.id,
      label: g.label ?? "",
      sortKey: g.sortKey,
    });
  }

  // Build changed rows.
  const changedRows: ChangedRow[] = [];
  for (const t of fetchedTodos) {
    const fields = changedTodoFields.get(t.id);
    if (!fields) continue;
    const change: ChangedRow = { kind: "todo", id: t.id };
    if (fields.has("title")) (change as { title?: string }).title = t.title ?? "";
    if (fields.has("note")) (change as { note?: string }).note = t.note ?? "";
    if (fields.has("done")) (change as { done?: boolean }).done = t.done;
    if (fields.has("planned")) (change as { planned?: string | null }).planned = t.planned;
    changedRows.push(change);
  }
  for (const g of fetchedGroups) {
    const fields = changedGroupFields.get(g.id);
    if (!fields) continue;
    const change: ChangedRow = { kind: "group", id: g.id };
    if (fields.has("label")) (change as { label?: string }).label = g.label ?? "";
    changedRows.push(change);
  }

  // Check for project field changes.
  const projFieldLogs = await db
    .select({ update: projUpdateLog.update })
    .from(projUpdateLog)
    .where(
      and(
        eq(projUpdateLog.userId, userId),
        eq(projUpdateLog.projId, projId),
        gt(projUpdateLog.createdAtSeq, syncedAtSeq),
        inArray(projUpdateLog.update, ["name", "note"]),
      ),
    );
  let projFields: { name?: string; note?: string } | undefined;
  if (projFieldLogs.length > 0) {
    const [proj] = await db
      .select({ name: projTable.name, note: projTable.note })
      .from(projTable)
      .where(eq(projTable.id, projId));
    if (proj) {
      projFields = {};
      if (projFieldLogs.some((l) => l.update === "name")) projFields.name = proj.name ?? "";
      if (projFieldLogs.some((l) => l.update === "note")) projFields.note = proj.note ?? "";
    }
  }

  return {
    newSeq,
    enteredRows,
    changedRows,
    exitedRowIds: [...trulyExitedTodoIds, ...trulyExitedGroupIds],
    ...(projFields && { projFields }),
  };
}

// Full bootstrap for a project.
async function fullProjFetch(
  userId: string,
  projId: string,
  newSeq: number,
): Promise<ProjDelta> {
  const [proj] = await db
    .select()
    .from(projTable)
    .where(and(eq(projTable.id, projId), eq(projTable.userId, userId)));
  if (!proj) {
    return { newSeq, enteredRows: [], changedRows: [], exitedRowIds: [] };
  }

  const [todos, groups] = await Promise.all([
    db.select().from(todoTable)
      .where(and(
        eq(todoTable.projId, projId),
        eq(todoTable.userId, userId),
        eq(todoTable.placement, "project"),
      ))
      .orderBy(asc(todoTable.sortKey)),
    db.select().from(groupTable)
      .where(eq(groupTable.projId, projId))
      .orderBy(asc(groupTable.sortKey)),
  ]);

  const todoIds = todos.map((t) => t.id);
  const checks = todoIds.length > 0
    ? await db.select().from(checkTable)
        .where(inArray(checkTable.todoId, todoIds))
        .orderBy(asc(checkTable.sortKey))
    : [];
  const checksByTodo = new Map<string, typeof checks>();
  for (const c of checks) {
    const list = checksByTodo.get(c.todoId) ?? [];
    list.push(c);
    checksByTodo.set(c.todoId, list);
  }

  const enteredRows: PullRow[] = [];
  for (const t of todos) {
    enteredRows.push({
      kind: "todo",
      id: t.id,
      title: t.title ?? "",
      note: t.note ?? "",
      done: t.done,
      planned: t.planned,
      sortKey: t.sortKey,
      checks: (checksByTodo.get(t.id) ?? []).map((c) => ({
        id: c.id,
        content: c.content,
        ticked: c.ticked,
        sortKey: c.sortKey,
      })),
    });
  }
  for (const g of groups) {
    enteredRows.push({
      kind: "group",
      id: g.id,
      label: g.label ?? "",
      sortKey: g.sortKey,
    });
  }

  return {
    newSeq,
    enteredRows,
    changedRows: [],
    exitedRowIds: [],
    projFields: { name: proj.name ?? "", note: proj.note ?? "" },
  };
}

// ─── Project list delta ───────────────────────────────────────────────────────

export async function buildProjListDelta(
  userId: string,
  _syncedAtSeq: number | undefined,
): Promise<ProjListDelta> {
  const [user] = await db
    .select({ mutateSeq: userTable.mutateSeq })
    .from(userTable)
    .where(eq(userTable.id, userId));
  const newSeq = user?.mutateSeq ?? 0;

  // Always return the full active project list for now.
  // Delta computation on projList can be added later.
  const projs = await db
    .select()
    .from(projTable)
    .where(and(eq(projTable.userId, userId), eq(projTable.placement, "list")))
    .orderBy(asc(projTable.sortKey));

  const projects: ProjListEntry[] = projs.map((p) => ({
    id: p.id,
    name: p.name ?? "",
    note: p.note ?? "",
    sortKey: p.sortKey,
    placement: p.placement,
  }));

  return { newSeq, projects };
}

// Where a project currently lives: "list" (active), "archive", "trash", or null
// if it doesn't exist / isn't owned by this user. Used to prefetch any open
// project by id and tell the client whether it's a placement drill-in.
export async function getProjPlacement(
  userId: string,
  projId: string,
): Promise<"list" | "archive" | "trash" | null> {
  const [row] = await db
    .select({ placement: projTable.placement })
    .from(projTable)
    .where(and(eq(projTable.userId, userId), eq(projTable.id, projId)));
  return row?.placement ?? null;
}

// ─── Placement views (inbox / archive / trash) ────────────────────────────────

export async function buildPlacementDelta(
  userId: string,
  placement: "inbox" | "archive" | "trash",
): Promise<PlacementDelta> {
  const [user] = await db
    .select({ mutateSeq: userTable.mutateSeq })
    .from(userTable)
    .where(eq(userTable.id, userId));
  const newSeq = user?.mutateSeq ?? 0;

  const todos = await db
    .select()
    .from(todoTable)
    .where(and(eq(todoTable.userId, userId), eq(todoTable.placement, placement)))
    .orderBy(desc(todoTable.sortKey)); // most recently added first

  const todoIds = todos.map((t) => t.id);
  const fetchedChecks = todoIds.length > 0
    ? await db.select().from(checkTable).where(inArray(checkTable.todoId, todoIds)).orderBy(asc(checkTable.sortKey))
    : [];
  const checksByTodo = new Map<string, typeof fetchedChecks>();
  for (const c of fetchedChecks) {
    const list = checksByTodo.get(c.todoId) ?? [];
    list.push(c);
    checksByTodo.set(c.todoId, list);
  }

  const entries = todos.map((t) => ({
    kind: "todo" as const,
    id: t.id,
    title: t.title ?? "",
    note: t.note ?? "",
    done: t.done,
    planned: t.planned,
    sortKey: t.sortKey,
    projId: t.projId,
    checks: (checksByTodo.get(t.id) ?? []).map((c) => ({
      id: c.id,
      text: c.content ?? "",
      ticked: c.ticked,
      sortKey: c.sortKey,
    })),
  }));

  if (placement === "inbox") {
    return { newSeq, entries };
  }

  // Archive / trash also contain projects.
  const projs = await db
    .select()
    .from(projTable)
    .where(and(eq(projTable.userId, userId), eq(projTable.placement, placement)))
    .orderBy(desc(projTable.sortKey));

  const projEntries = projs.map((p) => ({
    kind: "proj" as const,
    id: p.id,
    name: p.name ?? "",
    sortKey: p.sortKey,
  }));

  // Merge and sort by sortKey descending (most recently archived first).
  const all = [...entries, ...projEntries].sort((a, b) => b.sortKey - a.sortKey);

  return { newSeq, entries: all };
}
