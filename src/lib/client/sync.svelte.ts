// Delta sync engine.
//
// Mutation overlay + syncedAtSeq:
//   Each user action writes into `overlay` (latest value per field per entity)
//   and `scopeOverlay` (structural changes per scope). At dispatch time the
//   engine composes the wire payload from the overlay and the current
//   syncedAtSeq, sends it, then on ack:
//     1. Merges the server delta into the cache.
//     2. Advances syncedAtSeq[scope] = ack.newSeq.
//     3. Clears overlay entries confirmed in the dispatched push.
//     4. If the overlay still has pending mutations, immediately composes
//        and dispatches the next push.
//
// One push is in-flight at a time. Further mutations accumulate in the
// overlay while a push is in-flight and are composed into the next push
// after ack.

import { CalendarDate } from "@internationalized/date";
import type {
  AppState,
  ProjectItem,
  RowItem,
  TodoItem,
  CheckItem,
} from "./model";
import {
  newCheckItem,
  newGroupingItem,
  newProjectItem,
  newTodoItem,
} from "./model";
import type {
  ProjDelta,
  ProjListDelta,
  PlacementDelta,
  PushResponse,
} from "$lib/server/sync/types";

// ─── Overlay types ────────────────────────────────────────────────────────────

export type FieldEntry = { value: unknown; pushSeq: number };

export type TodoFieldOverlay = {
  title?: FieldEntry;
  note?: FieldEntry;
  done?: FieldEntry;
  planned?: FieldEntry; // string | null
};

export type GroupFieldOverlay = {
  label?: FieldEntry;
};

export type ProjFieldOverlay = {
  name?: FieldEntry;
  note?: FieldEntry;
};

export type CheckFieldOverlay = {
  content?: FieldEntry;
  ticked?: FieldEntry;
};

export type EntityOverlay =
  | { kind: "todo"; projId: string | null; placement: string; fields: TodoFieldOverlay }
  | { kind: "group"; projId: string; fields: GroupFieldOverlay }
  | { kind: "proj"; fields: ProjFieldOverlay }
  | { kind: "check"; todoId: string; projId: string | null; placement: string; fields: CheckFieldOverlay };

// Per-scope structural changes (ordering, creates, deletes, moves).
export type ScopeOverlay = {
  pushSeq: number;
  // Full new order of rows/checks/projs (we always send the complete order).
  rowOrder?: { entries: OrderRowEntry[]; pushSeq: number };
  checkOrder?: Record<string, { entries: OrderCheckEntry[]; pushSeq: number }>;  // todoId → check order
  deleteRowIds?: { id: string; kind: "todo" | "group" }[];
  moveOutRowIds?: { id: string; kind: "todo" | "group" }[];
  // New proj-list position.
  projListOrder?: { entries: string[]; pushSeq: number };  // ordered projIds
};

export type OrderRowEntry = {
  rowId: string;
  kind: "todo" | "group";
  startAtIndex: number;
  moveHere?: boolean;
  createHere?: boolean;
};

export type OrderCheckEntry = {
  checkId: string;
  startAtIndex: number;
  createHere?: boolean;
};

// Placement changes: items being moved into archive/trash/inbox.
// Field + checklist data for a placement todo the server must CREATE (one that
// never lived in a project). Carried inline on the move so composePush builds
// the slice `data` directly — routing checks through todoUpdates instead would
// no-op, since that runs before the arrange and the todo doesn't exist yet.
// Used by the sign-up migration of a guest's inbox/archive/trash todos.
export type PlacementTodoData = {
  title?: string;
  note?: string;
  done?: boolean;
  planned?: string | null;
  checks?: { id: string; content: string; ticked: boolean }[];
};
export type PlacementMoveTodo = { kind: "todo"; todoId: string; placement: "archive" | "trash" | "inbox"; associateProjId?: string; data?: PlacementTodoData; pushSeq: number };
export type PlacementMoveProj = { kind: "proj"; projId: string; placement: "archive" | "trash"; pushSeq: number };
export type PlacementMoveEntry = PlacementMoveTodo | PlacementMoveProj;

// ─── Reactive engine state ────────────────────────────────────────────────────

export const syncStatus = $state<{
  pinnedUserId: string | null;
  inflight: boolean;
  error: string | null;
  // The current push sequence number. Incremented each time a push is dispatched.
  pushSeq: number;
}>({
  pinnedUserId: null,
  inflight: false,
  error: null,
  pushSeq: 0,
});

// Per-scope syncedAtSeq. Keyed by `proj:{projId}`, `projList`, `inbox`, `archive`, `trash`.
export const syncedAtSeq: Record<string, number> = $state({});

// Field overlay: entityId → overlay entry.
export const overlay: Map<string, EntityOverlay> = $state(new Map());

// Scope structural overlay: scopeKey → scope overlay.
export const scopeOverlay: Map<string, ScopeOverlay> = $state(new Map());

// Placement moves pending push.
export const placementMoves: PlacementMoveEntry[] = $state([]);

let initialized = false;

// ─── Init / user management ──────────────────────────────────────────────────

export const initSync = (pinnedUserId: string | null) => {
  initialized = true;
  syncStatus.pinnedUserId = pinnedUserId;
  if (pinnedUserId != null && hasPendingMutations()) void drive();
};

export const setPinnedUser = (userId: string | null) => {
  if (syncStatus.pinnedUserId === userId) return;
  syncStatus.pinnedUserId = userId;
  if (userId == null) {
    resetSyncState();
  } else if (initialized && hasPendingMutations()) {
    void drive();
  }
};

// Drop every piece of per-session sync bookkeeping. Call whenever the signed-in
// user changes (sign-in, sign-out, account switch) so a previous session's
// state can't leak into the next. In particular `syncedAtSeq` is per-user, per-
// scope: left behind, the next sign-in pulls each project incrementally against
// a seq that already matches the server and gets back an empty delta — the
// project renders with no rows until a reload bootstraps it. The overlay maps
// can likewise hold a guest's never-synced edits, which must not be replayed
// against the account being signed into.
export const resetSyncState = () => {
  for (const k of Object.keys(syncedAtSeq)) delete syncedAtSeq[k];
  overlay.clear();
  scopeOverlay.clear();
  placementMoves.length = 0;
  syncStatus.error = null;
};

// ─── Mutation recording ───────────────────────────────────────────────────────

// Record a field change on an entity. Call AFTER applying the change locally.
export const recordTodoEdit = (
  todoId: string,
  projId: string | null,
  placement: string,
  fields: Partial<{ title: string; note: string; done: boolean; planned: string | null }>,
) => {
  const seq = syncStatus.pushSeq;
  let entry = overlay.get(todoId);
  if (!entry || entry.kind !== "todo") {
    entry = { kind: "todo", projId, placement, fields: {} };
    overlay.set(todoId, entry);
  }
  const f = (entry as { kind: "todo"; projId: string | null; placement: string; fields: TodoFieldOverlay }).fields;
  if (fields.title !== undefined) f.title = { value: fields.title, pushSeq: seq };
  if (fields.note !== undefined) f.note = { value: fields.note, pushSeq: seq };
  if (fields.done !== undefined) f.done = { value: fields.done, pushSeq: seq };
  if (fields.planned !== undefined) f.planned = { value: fields.planned, pushSeq: seq };
  scheduleDispatch();
};

export const recordGroupEdit = (groupId: string, projId: string, fields: Partial<{ label: string }>) => {
  const seq = syncStatus.pushSeq;
  let entry = overlay.get(groupId);
  if (!entry || entry.kind !== "group") {
    entry = { kind: "group", projId, fields: {} };
    overlay.set(groupId, entry);
  }
  const f = (entry as { kind: "group"; projId: string; fields: GroupFieldOverlay }).fields;
  if (fields.label !== undefined) f.label = { value: fields.label, pushSeq: seq };
  scheduleDispatch();
};

export const recordProjEdit = (projId: string, fields: Partial<{ name: string; note: string }>) => {
  const seq = syncStatus.pushSeq;
  let entry = overlay.get(projId);
  if (!entry || entry.kind !== "proj") {
    entry = { kind: "proj", fields: {} };
    overlay.set(projId, entry);
  }
  const f = (entry as { kind: "proj"; fields: ProjFieldOverlay }).fields;
  if (fields.name !== undefined) f.name = { value: fields.name, pushSeq: seq };
  if (fields.note !== undefined) f.note = { value: fields.note, pushSeq: seq };
  scheduleDispatch();
};

export const recordCheckEdit = (
  checkId: string,
  todoId: string,
  projId: string | null,
  placement: string,
  fields: Partial<{ content: string; ticked: boolean }>,
) => {
  const seq = syncStatus.pushSeq;
  let entry = overlay.get(checkId);
  if (!entry || entry.kind !== "check") {
    entry = { kind: "check", todoId, projId, placement, fields: {} };
    overlay.set(checkId, entry);
  }
  const f = (entry as { kind: "check"; todoId: string; projId: string | null; placement: string; fields: CheckFieldOverlay }).fields;
  if (fields.content !== undefined) f.content = { value: fields.content, pushSeq: seq };
  if (fields.ticked !== undefined) f.ticked = { value: fields.ticked, pushSeq: seq };
  scheduleDispatch();
};

export const recordRowOrder = (projId: string, entries: OrderRowEntry[]) => {
  const seq = syncStatus.pushSeq;
  const key = `proj:${projId}`;
  const s = scopeOverlay.get(key) ?? { pushSeq: seq };
  s.rowOrder = { entries, pushSeq: seq };
  s.pushSeq = seq;
  scopeOverlay.set(key, s);
  scheduleDispatch();
};

export const recordCheckOrder = (projId: string, todoId: string, entries: OrderCheckEntry[]) => {
  const seq = syncStatus.pushSeq;
  const key = `proj:${projId}`;
  const s = scopeOverlay.get(key) ?? { pushSeq: seq };
  s.checkOrder = s.checkOrder ?? {};
  s.checkOrder[todoId] = { entries, pushSeq: seq };
  s.pushSeq = seq;
  scopeOverlay.set(key, s);
  scheduleDispatch();
};

export const recordPlacementCheckOrder = (todoId: string, entries: OrderCheckEntry[]) => {
  const seq = syncStatus.pushSeq;
  const key = `todo:${todoId}`;
  const s = scopeOverlay.get(key) ?? { pushSeq: seq };
  s.checkOrder = s.checkOrder ?? {};
  s.checkOrder[todoId] = { entries, pushSeq: seq };
  s.pushSeq = seq;
  scopeOverlay.set(key, s);
  scheduleDispatch();
};

export const recordProjListOrder = (projIds: string[]) => {
  const seq = syncStatus.pushSeq;
  const key = "projList";
  const s = scopeOverlay.get(key) ?? { pushSeq: seq };
  s.projListOrder = { entries: projIds, pushSeq: seq };
  s.pushSeq = seq;
  scopeOverlay.set(key, s);
  scheduleDispatch();
};

export const recordRowDelete = (projId: string, rowId: string, kind: "todo" | "group") => {
  const seq = syncStatus.pushSeq;
  const key = `proj:${projId}`;
  const s = scopeOverlay.get(key) ?? { pushSeq: seq };
  s.deleteRowIds = [...(s.deleteRowIds ?? []), { id: rowId, kind }];
  s.pushSeq = seq;
  scopeOverlay.set(key, s);
  scheduleDispatch();
};

export const recordRowMoveOut = (projId: string, rowId: string, kind: "todo" | "group") => {
  const seq = syncStatus.pushSeq;
  const key = `proj:${projId}`;
  const s = scopeOverlay.get(key) ?? { pushSeq: seq };
  s.moveOutRowIds = [...(s.moveOutRowIds ?? []), { id: rowId, kind }];
  s.pushSeq = seq;
  scopeOverlay.set(key, s);
  scheduleDispatch();
};

export const recordPlacementMove = (entry: Omit<PlacementMoveTodo, "pushSeq"> | Omit<PlacementMoveProj, "pushSeq">) => {
  placementMoves.push({ ...entry, pushSeq: syncStatus.pushSeq } as PlacementMoveEntry);
  scheduleDispatch();
};

export const recordProjCreate = (projId: string) => {
  const seq = syncStatus.pushSeq;
  const key = `proj:${projId}`;
  scopeOverlay.set(key, { pushSeq: seq, rowOrder: { entries: [], pushSeq: seq } });
  scheduleDispatch();
};

export const recordProjDelete = (projId: string) => {
  const seq = syncStatus.pushSeq;
  const key = `projDelete:${projId}`;
  scopeOverlay.set(key, { pushSeq: seq });
  scheduleDispatch();
};

export const recordTodoDelete = (todoId: string, projId: string | null) => {
  const seq = syncStatus.pushSeq;
  const key = `todoDelete:${todoId}`;
  scopeOverlay.set(key, { pushSeq: seq });
  // Store projId in overlay for routing.
  overlay.set(todoId, { kind: "todo", projId, placement: "project", fields: {} });
  scheduleDispatch();
};

// ─── Push composition ─────────────────────────────────────────────────────────

function composePush(): object | null {
  if (!hasPendingMutations()) return null;

  const dispatchSeq = syncStatus.pushSeq;

  // Group entity overlays by project scope.
  const projEntityMap = new Map<string, {
    todos: Map<string, { entry: Extract<EntityOverlay, { kind: "todo" }>; id: string }>;
    groups: Map<string, { entry: Extract<EntityOverlay, { kind: "group" }>; id: string }>;
    proj?: { entry: Extract<EntityOverlay, { kind: "proj" }>; id: string };
    checks: Map<string, { entry: Extract<EntityOverlay, { kind: "check" }>; id: string }>;
  }>();

  const getOrCreateProjMap = (projId: string) => {
    let m = projEntityMap.get(projId);
    if (!m) {
      m = { todos: new Map(), groups: new Map(), checks: new Map() };
      projEntityMap.set(projId, m);
    }
    return m;
  };

  for (const [id, entry] of overlay) {
    if (entry.kind === "todo" && entry.projId) {
      const m = getOrCreateProjMap(entry.projId);
      m.todos.set(id, { entry: entry as Extract<EntityOverlay, { kind: "todo" }>, id });
    } else if (entry.kind === "group") {
      const e = entry as Extract<EntityOverlay, { kind: "group" }>;
      const m = getOrCreateProjMap(e.projId);
      m.groups.set(id, { entry: e, id });
    } else if (entry.kind === "proj") {
      const e = entry as Extract<EntityOverlay, { kind: "proj" }>;
      const m = getOrCreateProjMap(id);
      m.proj = { entry: e, id };
    } else if (entry.kind === "check" && entry.projId != null) {
      const e = entry as Extract<EntityOverlay, { kind: "check" }>;
      const m = getOrCreateProjMap(e.projId as string);
      m.checks.set(id, { entry: e, id });
    }
  }

  // Collect proj-level scope overlays.
  const projScopeKeys = new Set<string>();
  for (const key of scopeOverlay.keys()) {
    if (key.startsWith("proj:")) projScopeKeys.add(key.slice(5));
  }
  for (const projId of projEntityMap.keys()) projScopeKeys.add(projId);

  const projUpdates: object[] = [];
  for (const projId of projScopeKeys) {
    const entityMap = projEntityMap.get(projId);
    const scope = scopeOverlay.get(`proj:${projId}`);

    const editRows: Record<string, object> = {};

    // Todo field edits.
    for (const [todoId, { entry }] of entityMap?.todos ?? []) {
      const f = entry.fields;
      const edit: Record<string, unknown> = { kind: "todo" };
      if (f.title) edit.title = f.title.value;
      if (f.note) edit.note = f.note.value;
      if (f.done) edit.done = f.done.value;
      if (f.planned) edit.planned = f.planned.value;
      if (Object.keys(edit).length > 1) editRows[todoId] = edit;
    }

    // Group field edits.
    for (const [groupId, { entry }] of entityMap?.groups ?? []) {
      const f = entry.fields;
      const edit: Record<string, unknown> = { kind: "group" };
      if (f.label) edit.label = f.label.value;
      if (Object.keys(edit).length > 1) editRows[groupId] = edit;
    }

    // Check edits — nested into todoUpdate style via editRows.
    const checkEditsByTodo = new Map<string, Record<string, object>>();
    for (const [checkId, { entry }] of entityMap?.checks ?? []) {
      const f = entry.fields;
      const edit: Record<string, unknown> = {};
      if (f.content) edit.content = f.content.value;
      if (f.ticked) edit.ticked = f.ticked.value;
      if (Object.keys(edit).length === 0) continue;
      // Attach to the parent todo's editRows entry.
      const todoId = (entry as Extract<EntityOverlay, { kind: "check" }>).todoId;
      let todoEdit = editRows[todoId] as Record<string, unknown> | undefined;
      if (!todoEdit) {
        todoEdit = { kind: "todo" };
        editRows[todoId] = todoEdit;
      }
      if (!todoEdit.editChecks) todoEdit.editChecks = {};
      (todoEdit.editChecks as Record<string, object>)[checkId] = edit;
      // Also store in checkEditsByTodo for check order reference.
      const byTodo = checkEditsByTodo.get(todoId) ?? {};
      byTodo[checkId] = edit as object;
      checkEditsByTodo.set(todoId, byTodo);
    }

    const pu: Record<string, unknown> = {
      projId,
      syncedAtSeq: syncedAtSeq[`proj:${projId}`] ?? 0,
    };

    // Project field edits.
    if (entityMap?.proj) {
      const f = entityMap.proj.entry.fields;
      if (f.name) pu.name = f.name.value;
      if (f.note) pu.note = f.note.value;
    }

    if (Object.keys(editRows).length > 0) pu.editRows = editRows;
    if (scope?.rowOrder) pu.orderRows = scope.rowOrder.entries;
    if (scope?.deleteRowIds && scope.deleteRowIds.length > 0) {
      pu.deleteRows = Object.fromEntries(scope.deleteRowIds.map((r) => [r.id, r.kind]));
    }
    if (scope?.moveOutRowIds && scope.moveOutRowIds.length > 0) {
      pu.moveOutRows = Object.fromEntries(scope.moveOutRowIds.map((r) => [r.id, r.kind]));
    }

    // Check orders per todo.
    if (scope?.checkOrder) {
      for (const [todoId, { entries }] of Object.entries(scope.checkOrder)) {
        let todoEdit = editRows[todoId] as Record<string, unknown> | undefined;
        if (!todoEdit) {
          todoEdit = { kind: "todo" };
          editRows[todoId] = todoEdit;
        }
        todoEdit.orderChecks = entries;
        pu.editRows = editRows;
      }
    }

    projUpdates.push(pu);
  }

  // Proj-list reorder.
  let projsArrange: object | undefined;
  const listScope = scopeOverlay.get("projList");
  if (listScope?.projListOrder) {
    projsArrange = {
      orderProjs: listScope.projListOrder.entries.map((projId, i) => ({
        projId,
        startAtIndex: i,
        positionSyncedAtSeq: syncedAtSeq["projList"] ?? 0,
      })),
    };
  }

  // Proj deletes.
  const projDeletes: object[] = [];
  for (const key of scopeOverlay.keys()) {
    if (!key.startsWith("projDelete:")) continue;
    const projId = key.slice("projDelete:".length);
    projDeletes.push({ projId, positionSyncedAtSeq: syncedAtSeq["projList"] ?? 0 });
  }

  // Todo deletes.
  const todoDeletes: object[] = [];
  for (const key of scopeOverlay.keys()) {
    if (!key.startsWith("todoDelete:")) continue;
    const todoId = key.slice("todoDelete:".length);
    todoDeletes.push({ todoId, positionSyncedAtSeq: 0 });
  }

  // Standalone todo/check edits for placement todos (projId=null — inbox/archive/trash).
  // These are not routed through projUpdates; emit them via todoUpdates instead.
  const todoUpdateMap = new Map<string, Record<string, unknown>>();
  const getPlacementTu = (todoId: string) => {
    let tu = todoUpdateMap.get(todoId);
    if (!tu) { tu = { todoId }; todoUpdateMap.set(todoId, tu); }
    return tu;
  };

  for (const [id, entry] of overlay) {
    if (entry.kind === "todo" && entry.projId == null) {
      const f = (entry as Extract<EntityOverlay, { kind: "todo" }>).fields;
      const tu = getPlacementTu(id);
      if (f.title) tu.title = f.title.value;
      if (f.note) tu.note = f.note.value;
      if (f.done) tu.done = f.done.value;
      if (f.planned) tu.planned = f.planned.value;
    } else if (entry.kind === "check" && entry.projId == null) {
      const e = entry as Extract<EntityOverlay, { kind: "check" }>;
      const tu = getPlacementTu(e.todoId);
      const checkEdit: Record<string, unknown> = {};
      if (e.fields.content) checkEdit.content = e.fields.content.value;
      if (e.fields.ticked) checkEdit.ticked = e.fields.ticked.value;
      if (Object.keys(checkEdit).length > 0) {
        (tu.editChecks as Record<string, unknown> | undefined) ??= {};
        (tu.editChecks as Record<string, unknown>)[id] = checkEdit;
      }
    }
  }

  for (const [key, scope] of scopeOverlay) {
    if (!key.startsWith("todo:")) continue;
    const todoId = key.slice("todo:".length);
    const co = scope.checkOrder?.[todoId];
    if (!co) continue;
    const tu = getPlacementTu(todoId);
    tu.orderChecks = co.entries.map((e) => ({ checkId: e.checkId, startAtIndex: e.startAtIndex, ...(e.createHere && { createHere: true }) }));
  }

  const todoUpdates = [...todoUpdateMap.values()].filter((tu) => Object.keys(tu).length > 1);

  // Placement moves.
  const archiveSlice: object[] = [];
  const trashSlice: object[] = [];
  const inboxSlice: object[] = [];

  for (const mv of placementMoves) {
    if (mv.placement === "archive") {
      if (mv.kind === "todo") {
        archiveSlice.push({ kind: "todo", todoId: mv.todoId, createHere: true, associateProjId: mv.associateProjId, ...(mv.data && { data: mv.data }) });
      } else {
        archiveSlice.push({ kind: "proj", projId: mv.projId, createHere: true });
      }
    } else if (mv.placement === "trash") {
      if (mv.kind === "todo") {
        trashSlice.push({ kind: "todo", todoId: mv.todoId, createHere: true, associateProjId: mv.associateProjId, ...(mv.data && { data: mv.data }) });
      } else {
        trashSlice.push({ kind: "proj", projId: mv.projId, createHere: true });
      }
    } else if (mv.placement === "inbox") {
      // For a todo created directly in the inbox the server has no existing row
      // to fill in from todoUpdates (which is applied before inboxArrange and
      // no-ops on a missing todo), so carry its field data inline here. For a
      // move-into-inbox the todo already exists server-side and `data` is ignored.
      const entry: Record<string, unknown> = { todoId: mv.todoId, createHere: true };
      if (mv.data) {
        // Migration: full field + check data carried on the move.
        entry.data = mv.data;
      } else {
        const ov = overlay.get(mv.todoId);
        if (ov && ov.kind === "todo") {
          const f = (ov as Extract<EntityOverlay, { kind: "todo" }>).fields;
          const data: Record<string, unknown> = {};
          if (f.title) data.title = f.title.value;
          if (f.note) data.note = f.note.value;
          if (f.done) data.done = f.done.value;
          if (f.planned) data.planned = f.planned.value;
          if (Object.keys(data).length > 0) entry.data = data;
        }
      }
      inboxSlice.push(entry);
    }
  }

  const body: Record<string, unknown> = {};
  if (projUpdates.length > 0) body.projUpdates = projUpdates;
  if (projDeletes.length > 0) body.projDeletes = projDeletes;
  if (projsArrange) body.projsArrange = projsArrange;
  if (archiveSlice.length > 0) body.archiveArrange = { slice: archiveSlice };
  if (trashSlice.length > 0) body.trashArrange = { slice: trashSlice };
  if (inboxSlice.length > 0) body.inboxArrange = { slice: inboxSlice };
  if (todoUpdates.length > 0) body.todoUpdates = todoUpdates;
  if (todoDeletes.length > 0) body.todoDeletes = todoDeletes;

  if (Object.keys(body).length === 0) return null;

  return { ...body, _dispatchSeq: dispatchSeq };
}

// ─── Drive (dispatch loop) ────────────────────────────────────────────────────

let dispatchScheduled = false;

function scheduleDispatch() {
  if (syncStatus.pinnedUserId == null) return;
  if (!initialized) return;
  if (dispatchScheduled) return;
  dispatchScheduled = true;
  // Micro-task delay so multiple synchronous mutations are batched.
  queueMicrotask(() => {
    dispatchScheduled = false;
    void drive();
  });
}

async function drive() {
  if (syncStatus.inflight) return;
  if (!hasPendingMutations()) return;
  if (syncStatus.pinnedUserId == null) return;

  const payload = composePush();
  if (!payload) return;

  // Advance pushSeq so subsequent mutations get a higher seq.
  const dispatchedSeq = syncStatus.pushSeq;
  syncStatus.pushSeq++;
  syncStatus.inflight = true;

  const { _dispatchSeq, ...body } = payload as { _dispatchSeq: number; [k: string]: unknown };

  let retry = false;
  try {
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status >= 400 && res.status < 500) {
      const text = await res.text().catch(() => "");
      syncStatus.error = `push rejected: ${res.status} ${text}`;
      console.error("[sync]", syncStatus.error, body);
      // Drop the batch — client and server may be in different states.
      clearPushedEntries(dispatchedSeq);
    } else if (!res.ok) {
      throw new Error(`push failed: ${res.status} ${await res.text()}`);
    } else {
      syncStatus.error = null;
      const ack = (await res.json()) as PushResponse;
      applyAck(ack, dispatchedSeq);
    }
  } catch (e) {
    syncStatus.error = e instanceof Error ? e.message : String(e);
    retry = true;
  }

  if (retry) {
    // On network/5xx error, roll pushSeq back so the same mutations are
    // re-composed with the same seq on retry.
    syncStatus.pushSeq = dispatchedSeq;
    setTimeout(() => {
      syncStatus.inflight = false;
      void drive();
    }, 2000);
    return;
  }

  syncStatus.inflight = false;
  if (hasPendingMutations()) void drive();
}

// ─── Ack handling ─────────────────────────────────────────────────────────────

function applyAck(ack: PushResponse, dispatchedSeq: number) {
  // Advance syncedAtSeq for all touched scopes.
  const newSeq = ack.newSeq;
  if (ack.projDeltas) {
    for (const projId of Object.keys(ack.projDeltas)) {
      syncedAtSeq[`proj:${projId}`] = newSeq;
    }
  }
  if (ack.projListDelta) syncedAtSeq["projList"] = newSeq;
  if (ack.inboxDelta) syncedAtSeq["inbox"] = newSeq;
  if (ack.archiveDelta) syncedAtSeq["archive"] = newSeq;
  if (ack.trashDelta) syncedAtSeq["trash"] = newSeq;

  // Clear entries that were dispatched.
  clearPushedEntries(dispatchedSeq);
}

function clearPushedEntries(dispatchedSeq: number) {
  // Clear field overlay entries where all fields have pushSeq <= dispatchedSeq.
  for (const [id, entry] of overlay) {
    const fields = entry.fields as Record<string, FieldEntry | undefined>;
    for (const [k, fe] of Object.entries(fields)) {
      if (fe && fe.pushSeq <= dispatchedSeq) delete fields[k];
    }
    if (Object.values(fields).every((v) => v === undefined)) {
      overlay.delete(id);
    }
  }

  // Clear scope overlays where pushSeq <= dispatchedSeq.
  for (const [key, s] of scopeOverlay) {
    if (s.pushSeq <= dispatchedSeq) {
      scopeOverlay.delete(key);
      continue;
    }
    if (s.rowOrder?.pushSeq !== undefined && s.rowOrder.pushSeq <= dispatchedSeq) {
      delete s.rowOrder;
    }
    if (s.projListOrder?.pushSeq !== undefined && s.projListOrder.pushSeq <= dispatchedSeq) {
      delete s.projListOrder;
    }
    if (s.checkOrder) {
      for (const [todoId, co] of Object.entries(s.checkOrder)) {
        if (co.pushSeq <= dispatchedSeq) delete s.checkOrder[todoId];
      }
      if (Object.keys(s.checkOrder).length === 0) delete s.checkOrder;
    }
    if (s.deleteRowIds) {
      s.deleteRowIds = s.deleteRowIds.filter((r) => {
        // No per-entry pushSeq here; clear all if scope pushSeq was dispatched.
        return s.pushSeq > dispatchedSeq;
      });
    }
    if (s.moveOutRowIds) {
      s.moveOutRowIds = s.moveOutRowIds.filter(() => s.pushSeq > dispatchedSeq);
    }
  }

  // Clear placement moves.
  for (let i = placementMoves.length - 1; i >= 0; i--) {
    if (placementMoves[i].pushSeq <= dispatchedSeq) placementMoves.splice(i, 1);
  }
}

function hasPendingMutations(): boolean {
  return overlay.size > 0 || scopeOverlay.size > 0 || placementMoves.length > 0;
}

// ─── Explicit pull ────────────────────────────────────────────────────────────

export async function pullProj(
  projId: string,
  opts?: { full?: boolean },
): Promise<ProjDelta | null> {
  if (syncStatus.pinnedUserId == null) return null;
  try {
    // `full` forces a bootstrap fetch (omit syncedAtSeq) — used when opening a
    // trashed project, where a stale per-proj seq would yield a partial delta
    // that projectFromDelta can't reconstruct a whole project from.
    const r = await fetch("/api/sync/proj", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projId,
        syncedAtSeq: opts?.full ? undefined : syncedAtSeq[`proj:${projId}`],
      }),
    });
    if (!r.ok) {
      syncStatus.error = `proj pull failed: ${r.status}`;
      return null;
    }
    const delta = (await r.json()) as ProjDelta;
    syncedAtSeq[`proj:${projId}`] = delta.newSeq;
    return delta;
  } catch (e) {
    syncStatus.error = e instanceof Error ? e.message : String(e);
    return null;
  }
}

export async function pullProjList(): Promise<ProjListDelta | null> {
  if (syncStatus.pinnedUserId == null) return null;
  try {
    const r = await fetch("/api/sync/list", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ syncedAtSeq: syncedAtSeq["projList"] }),
    });
    if (!r.ok) {
      syncStatus.error = `proj list pull failed: ${r.status}`;
      return null;
    }
    const delta = (await r.json()) as ProjListDelta;
    syncedAtSeq["projList"] = delta.newSeq;
    return delta;
  } catch (e) {
    syncStatus.error = e instanceof Error ? e.message : String(e);
    return null;
  }
}

export async function pullPlacement(
  placement: "inbox" | "archive" | "trash",
): Promise<PlacementDelta | null> {
  if (syncStatus.pinnedUserId == null) return null;
  try {
    const r = await fetch(`/api/sync/${placement}`);
    if (!r.ok) {
      syncStatus.error = `${placement} pull failed: ${r.status}`;
      return null;
    }
    const delta = (await r.json()) as PlacementDelta;
    syncedAtSeq[placement] = delta.newSeq;
    return delta;
  } catch (e) {
    syncStatus.error = e instanceof Error ? e.message : String(e);
    return null;
  }
}

// ─── Build client model from delta ───────────────────────────────────────────

export const parsePlanned = (s: string | null): CalendarDate | null => {
  if (s == null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new CalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
};

export const formatPlanned = (d: CalendarDate | null): string | null => {
  if (d == null) return null;
  const mm = String(d.month).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  return `${d.year}-${mm}-${dd}`;
};

// Build a full ProjectItem from a ProjDelta (bootstrap case: all rows in enteredRows).
export const projectFromDelta = (
  projId: string,
  name: string,
  note: string,
  delta: ProjDelta,
): ProjectItem => {
  // deltaToRows builds RowItems with no sortKey field, and the server emits
  // enteredRows todos-first-then-groups (not globally interleaved). Sort by the
  // sortKey carried on the raw delta rows so todos and groups re-interleave into
  // their true order — otherwise every grouping sinks below all todos on reload.
  const sortKeyById = new Map<string, number>(
    (delta.enteredRows as DeltaRow[]).map((r) => [r.id, r.sortKey]),
  );
  const rows = deltaToRows(delta.enteredRows);
  rows.sort((a, b) => (sortKeyById.get(a.id) ?? 0) - (sortKeyById.get(b.id) ?? 0));
  return { ...newProjectItem({ name, note, rows }), id: projId };
};

type DeltaRow = { kind: "todo" | "group"; id: string; sortKey: number; [k: string]: unknown };

function deltaToRows(enteredRows: DeltaRow[]): RowItem[] {
  return enteredRows.map((r) => {
    if (r.kind === "group") {
      return { ...newGroupingItem({ label: (r.label as string) ?? "" }), id: r.id };
    }
    const checks = ((r.checks as Array<{ id: string; content: string; ticked: boolean; sortKey: number }>) ?? [])
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((c) => ({ ...newCheckItem({ text: c.content, ticked: c.ticked }), id: c.id }));
    return {
      ...newTodoItem({
        title: (r.title as string) ?? "",
        note: (r.note as string) ?? "",
        status: (r.done as boolean) ? "complete" : "todo",
        planned: parsePlanned((r.planned as string | null) ?? null),
        checks,
      }),
      id: r.id,
    };
  });
}

// Apply a ProjDelta to an existing ProjectItem. Mutates in place.
export const applyProjDeltaToProject = (project: ProjectItem, delta: ProjDelta): void => {
  if (delta.projFields) {
    if (delta.projFields.name !== undefined) project.name = delta.projFields.name;
    if (delta.projFields.note !== undefined) project.note = delta.projFields.note;
  }

  // Add entered rows. The server emits enteredRows todos-first-then-groups, so
  // we can't just append — that would drop groupings below all todos. Each
  // entered row carries a sortKey; insert new rows at the position that sortKey
  // implies, relative to the other rows we have a sortKey for. On a full fetch
  // (lazy-load) every row is in this delta, so the interleaved order is fully
  // reconstructed; on an incremental delta only co-arriving rows are comparable,
  // so a lone new row falls back to appending.
  const sortKeyById = new Map<string, number>(
    (delta.enteredRows as DeltaRow[]).map((r) => [r.id, r.sortKey]),
  );
  const entered = deltaToRows(delta.enteredRows as DeltaRow[]);
  for (const row of entered) {
    const existing = project.rows.findIndex((r) => r.id === row.id);
    if (existing >= 0) {
      project.rows[existing] = row;
      continue;
    }
    const sk = sortKeyById.get(row.id)!;
    let insertAt = project.rows.length;
    for (let i = 0; i < project.rows.length; i++) {
      const otherSk = sortKeyById.get(project.rows[i].id);
      if (otherSk !== undefined && otherSk > sk) {
        insertAt = i;
        break;
      }
    }
    project.rows.splice(insertAt, 0, row);
  }

  // Apply field changes to existing rows.
  for (const change of delta.changedRows) {
    const row = project.rows.find((r) => r.id === change.id);
    if (!row) continue;
    if (change.kind === "todo") {
      const todo = row as TodoItem;
      if (change.title !== undefined) todo.title = change.title;
      if (change.note !== undefined) todo.note = change.note;
      if (change.done !== undefined) todo.status = change.done ? "complete" : "todo";
      if (change.planned !== undefined) todo.planned = parsePlanned(change.planned);
    } else {
      if (change.label !== undefined) (row as { label: string }).label = change.label;
    }
  }

  // Remove exited rows.
  const exitedSet = new Set(delta.exitedRowIds);
  project.rows = project.rows.filter((r) => !exitedSet.has(r.id));

  // When the delta is a full snapshot (every current row carries a sortKey),
  // trust it as the authoritative order. Skipped for incremental deltas — a
  // locally-created row not yet known to the server leaves a row without a
  // sortKey, so local order is never clobbered.
  if (project.rows.length > 0 && project.rows.every((r) => sortKeyById.has(r.id))) {
    project.rows.sort((a, b) => sortKeyById.get(a.id)! - sortKeyById.get(b.id)!);
  }
};

// Build the project list from a ProjListDelta.
export const projsFromListDelta = (delta: ProjListDelta, existing: ProjectItem[]): ProjectItem[] => {
  const byId = new Map(existing.map((p) => [p.id, p]));
  return delta.projects.map((entry) => {
    const existing = byId.get(entry.id);
    if (existing) {
      existing.name = entry.name;
      existing.note = entry.note;
      return existing;
    }
    return { ...newProjectItem({ name: entry.name, note: entry.note }), id: entry.id };
  });
};

// ─── Wire helpers ─────────────────────────────────────────────────────────────

export const projOrderOf = (state: AppState): string[] =>
  state.projects.filter((p) => !state.openProjPlacement.has(p.id)).map((p) => p.id);

export type RowOrderEntry = { kind: "todo" | "group"; id: string };

export const rowOrderOf = (proj: ProjectItem): OrderRowEntry[] =>
  proj.rows.map((r, i) => ({
    rowId: r.id,
    kind: ("label" in r ? "group" : "todo") as "todo" | "group",
    startAtIndex: i,
  }));

// Upload a guest's entire local state to the server on sign-up. Every project's
// content (fields + rows + checks) is recorded as a normal project edit; the
// proj-list order is sent for the active list; each archived/trashed project
// gets a placement move so the server files it under archive/trash (its rows
// ride along as placement="project", exactly as in the live app); and each
// standalone placement todo (inbox / archive / trash) is created directly in its
// placement with its fields + checks carried inline. Signed out, an
// archived/trashed project's content was parked in `stashedProjects`.
export const uploadInitialState = async (state: AppState): Promise<void> => {
  if (syncStatus.pinnedUserId == null) return;

  // Discard whatever the guest accumulated while signed out. Those mutations
  // never synced, and replaying them on top of the clean snapshot below would
  // conflict: e.g. a guest's "move todo to trash" was recorded without field
  // data, so left in the queue it creates the row as a shell first, and the
  // snapshot's data-carrying move then no-ops on the now-existing row. We upload
  // the final state, not the guest's edit history.
  overlay.clear();
  scopeOverlay.clear();
  placementMoves.length = 0;

  const recordProjectContent = (p: ProjectItem) => {
    recordProjEdit(p.id, { name: p.name, note: p.note });
    // Every row is brand-new on the server: mark createHere so applyRowOrder
    // INSERTs it (a plain reorder no-ops against rows that don't exist yet).
    recordRowOrder(
      p.id,
      p.rows.map((r, i) => ({
        rowId: r.id,
        kind: ("label" in r ? "group" : "todo") as "todo" | "group",
        startAtIndex: i,
        createHere: true,
      })),
    );
    for (const row of p.rows) {
      if ("label" in row) {
        recordGroupEdit(row.id, p.id, { label: row.label });
      } else {
        const todo = row as TodoItem;
        recordTodoEdit(todo.id, p.id, "project", {
          title: todo.title,
          note: todo.note,
          done: todo.status === "complete",
          planned: formatPlanned(todo.planned),
        });
        // Likewise createHere for each check, so the server INSERTs them (in
        // order) rather than logging edits against checks that don't exist.
        if (todo.checks.length > 0) {
          recordCheckOrder(
            p.id,
            todo.id,
            todo.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i, createHere: true })),
          );
        }
        for (const check of todo.checks) {
          recordCheckEdit(check.id, todo.id, p.id, "project", {
            content: check.text,
            ticked: check.ticked,
          });
        }
      }
    }
  };

  // Active projects (those not currently drilled-in from a placement view —
  // those are handled below as archive/trash projects).
  const active = state.projects.filter((p) => !state.openProjPlacement.has(p.id));
  for (const p of active) recordProjectContent(p);
  recordProjListOrder(active.map((p) => p.id));

  // Every project id being uploaded. An archived/trashed todo may name its
  // originating project (associateProjId) — keep that link only when the project
  // is here too, so the server's todo.projId FK holds.
  const projIds = new Set(active.map((p) => p.id));
  for (const e of [...state.archive, ...state.trash]) {
    if (e.kind === "proj") projIds.add(e.id);
  }

  // Archived / trashed entries. Iterate each list oldest-first (the lists are
  // newest-first) so the server's ascending sortKey reproduces the client's
  // display order. Projects upload their content then move placement; standalone
  // todos are created directly in the placement with their fields + checks.
  for (const [placement, entries] of [
    ["archive", state.archive],
    ["trash", state.trash],
  ] as const) {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.kind === "proj") {
        recordProjectContent(
          state.stashedProjects.get(e.id) ?? { id: e.id, name: e.name, note: "", rows: [] },
        );
        recordPlacementMove({ kind: "proj", projId: e.id, placement });
      } else {
        recordPlacementMove({
          kind: "todo",
          todoId: e.id,
          placement,
          ...(e.projId != null && projIds.has(e.projId) && { associateProjId: e.projId }),
          data: {
            title: e.title,
            note: e.note,
            done: e.done,
            planned: e.planned,
            checks: (e.checks ?? []).map((c) => ({ id: c.id, content: c.text, ticked: c.ticked })),
          },
        });
      }
    }
  }

  // Inbox todos (also newest-first), created directly in the inbox.
  for (let i = state.inbox.length - 1; i >= 0; i--) {
    const t = state.inbox[i];
    recordPlacementMove({
      kind: "todo",
      todoId: t.id,
      placement: "inbox",
      data: {
        title: t.title,
        note: t.note,
        done: t.status === "complete",
        planned: formatPlanned(t.planned),
        checks: t.checks.map((c) => ({ id: c.id, content: c.text, ticked: c.ticked })),
      },
    });
  }

  await settle();
};

// Settle: wait for the queue to drain.
export async function settle(timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  if (!syncStatus.inflight && hasPendingMutations()) void drive();
  while (Date.now() < deadline) {
    if (!syncStatus.inflight && !hasPendingMutations()) {
      return syncStatus.error == null;
    }
    if (!syncStatus.inflight && hasPendingMutations()) void drive();
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
