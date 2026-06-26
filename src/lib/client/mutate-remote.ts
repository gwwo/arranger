import {
  isTodoItem,
  isProjectInstance,
  isPlacementInstance,
  newProjectInstance,
  newPlacementInstance,
  newProjectItem,
  newTodoItem,
  newGroupingItem,
  newCheckItem,
  type TodoItem,
  type CheckInitData,
  type TodoInitData,
  type GroupingItem,
  type GroupingInitData,
  type TodoStatus,
  type ProjectInitData,
  isGroupingItem,
  type CheckItem,
  type ProjectItem,
  type AppState,
  type ArchiveTodoEntry,
} from "$lib/client/model";
import { createMutator, getPanelContext, getProjContext, getTodoContext } from "./context";
import {
  collectMoving,
  getInsertIndex,
  getProjectInstance,
  getTodo,
  insert,
  normalizeIds,
} from "./utils";
import {
  recordTodoEdit,
  recordGroupEdit,
  recordProjEdit,
  recordCheckEdit,
  recordRowOrder,
  recordCheckOrder,
  recordPlacementCheckOrder,
  recordProjListOrder,
  recordRowDelete,
  recordRowMoveOut,
  recordPlacementMove,
  recordProjCreate,
  recordProjDelete,
  recordTodoDelete,
  rowOrderOf,
  projOrderOf,
  formatPlanned,
  parsePlanned,
  syncStatus,
} from "./sync.svelte";
import type { CalendarDate } from "@internationalized/date";

// ─── Row moves / reorders ─────────────────────────────────────────────────────

export const useMoveRow = createMutator(
  () => getProjContext("useMoveRow: no project context"),
  (state, ctx, fromProjId: string, rowIds: string[], index?: number) => {
    if (rowIds.length === 0) return;
    const toProject = state.projects.find(({ id }) => id === ctx.projId);
    const fromProject = state.projects.find(({ id }) => id === fromProjId);
    if (toProject == null || fromProject == null) return;
    const { movingIds, moving } = collectMoving(fromProject.rows, rowIds);
    if (moving.length === 0) return;
    fromProject.rows = fromProject.rows.filter(({ id }) => !movingIds.has(id));
    toProject.rows = toProject.rows.filter(({ id }) => !movingIds.has(id));
    const insertAt =
      index ??
      (() => {
        const i = toProject.rows.findIndex((row) => isGroupingItem(row));
        return i >= 0 ? i : toProject.rows.length;
      })();
    insert(toProject.rows, insertAt, moving);
    if (toProject.id !== fromProject.id) {
      state.panels.forEach(({ instance }) => {
        if (!isProjectInstance(instance)) return;
        if (instance.project.id !== fromProject.id) return;
        for (const rowId of movingIds) {
          delete instance.rowSelected[rowId];
        }
      });
      recordRowOrder(toProject.id, rowOrderOf(toProject));
      recordRowOrder(fromProject.id, rowOrderOf(fromProject));
    } else {
      recordRowOrder(toProject.id, rowOrderOf(toProject));
    }
  },
);

export const useMoveFromPlacementToProject = createMutator(
  () => getProjContext("useMoveFromPlacementToProject: no project context"),
  (state, ctx, todoIds: string[], index: number) => {
    if (todoIds.length === 0) return;
    const toProject = state.projects.find(({ id }) => id === ctx.projId);
    if (toProject == null) return;

    const idSet = new Set(todoIds);
    const moving: TodoItem[] = [];

    for (const t of state.inbox) {
      if (idSet.has(t.id)) moving.push({ ...t });
    }
    state.inbox = state.inbox.filter((t) => !idSet.has(t.id));

    for (const e of state.archive) {
      if (idSet.has(e.id) && e.kind === "todo")
        moving.push({ id: e.id, title: e.title, note: e.note, status: e.done ? "complete" : "todo", planned: parsePlanned(e.planned), checks: e.checks ?? [] });
    }
    state.archive = state.archive.filter((e) => !idSet.has(e.id) || e.kind !== "todo");

    for (const e of state.trash) {
      if (idSet.has(e.id) && e.kind === "todo")
        moving.push({ id: e.id, title: e.title, note: e.note, status: e.done ? "complete" : "todo", planned: parsePlanned(e.planned), checks: e.checks ?? [] });
    }
    state.trash = state.trash.filter((e) => !idSet.has(e.id) || e.kind !== "todo");

    if (moving.length === 0) return;
    toProject.rows = toProject.rows.filter(({ id }) => !idSet.has(id));
    insert(toProject.rows, index, moving);

    const order = rowOrderOf(toProject).map((e) => ({
      ...e,
      ...(idSet.has(e.rowId) && { moveHere: true }),
    }));
    recordRowOrder(ctx.projId, order);
  },
);

export const useMoveCheck = createMutator(
  () => ({
    ...getProjContext("useMoveCheck: no project context"),
    ...getTodoContext("useMoveCheck: no todo context"),
  }),
  (state, ctx, checkIds: string[], index: number) => {
    if (checkIds.length === 0) return;
    const todo = getTodo(state, ctx);
    if (todo == null) return;
    const { movingIds, moving } = collectMoving(todo.checks, checkIds);
    if (moving.length === 0) return;
    todo.checks = todo.checks.filter(({ id }) => !movingIds.has(id));
    insert(todo.checks, index, moving);
    recordCheckOrder(
      ctx.projId,
      todo.id,
      todo.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i })),
    );
  },
);

export const useMoveProject = createMutator(
  () => null,
  (state, _, projIds: string[], index: number) => {
    if (projIds.length === 0) return;
    const { movingIds, moving } = collectMoving(state.projects, projIds);
    if (moving.length === 0) return;
    state.projects = state.projects.filter(({ id }) => !movingIds.has(id));
    insert(state.projects, index, moving);
    recordProjListOrder(projOrderOf(state));
  },
);

// Restore archived/trashed projects back into the active list at `index`
// (index is relative to the active list — i.e. projOrderOf order). The project's
// rows stay on the server (placement="project") while it's archived/trashed; we
// insert name-only stubs that lazy-load their content when opened, and push the
// new list order — which flips the projects to placement="list" server-side
// (applyProjsArrange).
export const useRestoreProjects = createMutator(
  () => null,
  (state, _, projIds: string[], index: number) => {
    if (projIds.length === 0) return;
    const idSet = new Set(projIds);
    const nameById = new Map<string, string>();
    for (const e of [...state.archive, ...state.trash]) {
      if (e.kind === "proj" && idSet.has(e.id)) nameById.set(e.id, e.name);
    }
    // Only restore ids actually in a placement list, in dragged order.
    const restoring = projIds.filter((id) => nameById.has(id));
    if (restoring.length === 0) return;

    state.archive = state.archive.filter((e) => !(e.kind === "proj" && idSet.has(e.id)));
    state.trash = state.trash.filter((e) => !(e.kind === "proj" && idSet.has(e.id)));

    // A project currently drilled into already sits in state.projects (as a
    // placement stub) but is held out of the active list by openProjPlacement.
    // Pull every restoring id out of state.projects up front so each one — newly
    // created stub or already-present drill-in — is reinserted together at the
    // drop position, instead of leaving the drill-in stranded where it was pushed.
    const restoringSet = new Set(restoring);
    const presentById = new Map(state.projects.map((p) => [p.id, p]));
    for (const id of restoring) state.openProjPlacement.delete(id);
    state.projects = state.projects.filter((p) => !restoringSet.has(p.id));

    // Build the restored projects in dragged order. An already-present project
    // (drilled into) keeps its identity and rows; for the rest, signed out the
    // parked project (with its rows) comes straight out of cold storage, signed
    // in it's a name-only stub the lazy loader fetches from the server.
    const freshIds = new Set<string>();
    const restored = restoring.map((id) => {
      const present = presentById.get(id);
      if (present) return present;
      freshIds.add(id);
      const stashed = state.stashedProjects.get(id);
      return stashed ?? { ...newProjectItem({ name: nameById.get(id)! }), id };
    });
    // Back in the active list, these are no longer cold-stored.
    for (const id of restoring) state.stashedProjects.delete(id);

    // Map the active-list index (projOrderOf order, with the restoring ids now
    // removed) to a state.projects index — other drilled-in placement projects
    // still live in state.projects but not in the active list.
    const active = state.projects.filter((p) => !state.openProjPlacement.has(p.id));
    const anchorId = active[index]?.id;
    const insertAt =
      anchorId != null ? state.projects.findIndex((p) => p.id === anchorId) : state.projects.length;
    insert(state.projects, insertAt < 0 ? state.projects.length : insertAt, restored);
    // Only the newly created server-backed stubs need a fetch. A restored drill-in
    // already carries (or doesn't) its own stub flag from when it was opened, and
    // cold-storage restores carry their rows — so neither is touched here. (Signed
    // out, pinnedUserId is null and nothing is stubbed.)
    if (syncStatus.pinnedUserId != null) for (const id of freshIds) state.projStub[id] = true;

    recordProjListOrder(projOrderOf(state));
  },
);

// ─── Todo edits ───────────────────────────────────────────────────────────────

export const useEditTodo = createMutator(
  () => ({
    ...getProjContext("useEditTodo: no project context"),
    ...getTodoContext("useEditTodo: no todo context"),
  }),
  (state, ctx, data: Partial<Omit<TodoItem, "checks" | "id">>) => {
    const todo = getTodo(state, ctx);
    if (todo == null) return;
    Object.assign(
      todo,
      Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
    );
    recordTodoEdit(todo.id, ctx.projId, "project", {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.note !== undefined && { note: data.note }),
      ...(data.status !== undefined && { done: data.status === "complete" }),
      ...(data.planned !== undefined && { planned: formatPlanned(data.planned) }),
    });
  },
);

export const useEditInboxTodo = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, data: Partial<Omit<TodoItem, "checks" | "id">>) => {
    const todo = state.inbox.find((t) => t.id === todoId);
    if (todo == null) return;
    Object.assign(
      todo,
      Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
    );
    recordTodoEdit(todo.id, null, "inbox", {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.note !== undefined && { note: data.note }),
      ...(data.status !== undefined && { done: data.status === "complete" }),
      ...(data.planned !== undefined && { planned: formatPlanned(data.planned) }),
    });
  },
);

// Batch-mark inbox todos done/undone (context-menu secondary action).
// Inbox equivalent of useMarkTodo.
export const useMarkInboxTodo = createMutator(
  () => ({}),
  (state, _ctx, todoIds: Set<string>, status: TodoStatus) => {
    for (const todo of state.inbox) {
      if (!todoIds.has(todo.id)) continue;
      todo.status = status;
      recordTodoEdit(todo.id, null, "inbox", { done: status === "complete" });
    }
  },
);

// Set/clear the planned date on inbox todos (bottom-bar date picker).
// Inbox equivalent of useSetPlanned.
export const useSetPlannedInbox = createMutator(
  () => ({}),
  (state, _ctx, todoIds: Set<string>, planned: CalendarDate | null) => {
    for (const todo of state.inbox) {
      if (!todoIds.has(todo.id)) continue;
      todo.planned = planned;
      recordTodoEdit(todo.id, null, "inbox", { planned: formatPlanned(planned) });
    }
  },
);

// Create a brand-new todo directly in the inbox (Space in the inbox view).
// Mirrors useCreateTodo, but the new row lives in state.inbox (placement
// "inbox", no project) and the new-todo selection/expansion is tracked on the
// placement instance rather than a project instance.
export const useCreateInboxTodo = createMutator(
  () => getPanelContext("useCreateInboxTodo: no panel context"),
  (state, ctx, item?: TodoInitData) => {
    const todo = newTodoItem(item);
    state.inbox.unshift(todo);
    const panel = state.panels.find(({ id }) => id === ctx.panelId);
    if (panel != null && isPlacementInstance(panel.instance) && panel.instance.kind === "inbox") {
      panel.instance.selected = new Set([todo.id]);
      panel.instance.expandedId = todo.id;
    }
    recordTodoEdit(todo.id, null, "inbox", {
      title: todo.title,
      note: todo.note,
      done: todo.status === "complete",
      planned: formatPlanned(todo.planned),
    });
    recordPlacementMove({ kind: "todo", todoId: todo.id, placement: "inbox" });
    return { id: todo.id };
  },
);

export const useEditTrashTodo = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, data: Partial<Omit<TodoItem, "checks" | "id">>) => {
    const entry = state.trash.find((e): e is ArchiveTodoEntry => e.kind === "todo" && e.id === todoId);
    if (entry == null) return;
    if (data.title !== undefined) entry.title = data.title;
    if (data.note !== undefined) entry.note = data.note;
    if (data.status !== undefined) entry.done = data.status === "complete";
    if (data.planned !== undefined) entry.planned = data.planned ? formatPlanned(data.planned) : null;
    recordTodoEdit(todoId, entry.projId, "trash", {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.note !== undefined && { note: data.note }),
      ...(data.status !== undefined && { done: data.status === "complete" }),
      ...(data.planned !== undefined && { planned: formatPlanned(data.planned) }),
    });
  },
);

// ─── Placement check edits (inbox / trash) ────────────────────────────────────

export const useEditInboxCheck = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, checkId: string, data: Partial<Omit<CheckItem, "id">>) => {
    const todo = state.inbox.find((t) => t.id === todoId);
    const check = todo?.checks.find((c) => c.id === checkId);
    if (check == null) return;
    if (data.text !== undefined) check.text = data.text;
    if (data.ticked !== undefined) check.ticked = data.ticked;
    recordCheckEdit(checkId, todoId, null, "inbox", {
      ...(data.text !== undefined && { content: data.text }),
      ...(data.ticked !== undefined && { ticked: data.ticked }),
    });
  },
);

export const useMoveInboxCheck = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, checkIds: string[], index: number) => {
    const todo = state.inbox.find((t) => t.id === todoId);
    if (todo == null) return;
    const { movingIds, moving } = collectMoving(todo.checks, checkIds);
    if (moving.length === 0) return;
    todo.checks = todo.checks.filter(({ id }) => !movingIds.has(id));
    insert(todo.checks, index, moving);
    recordPlacementCheckOrder(todoId, todo.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i })));
  },
);

// Set/clear the planned date on trashed todos (bottom-bar date picker).
// Trash equivalent of useSetPlannedInbox; skips project entries.
export const useSetPlannedTrash = createMutator(
  () => ({}),
  (state, _ctx, todoIds: Set<string>, planned: CalendarDate | null) => {
    for (const entry of state.trash) {
      if (entry.kind !== "todo" || !todoIds.has(entry.id)) continue;
      entry.planned = planned ? formatPlanned(planned) : null;
      recordTodoEdit(entry.id, entry.projId, "trash", { planned: formatPlanned(planned) });
    }
  },
);

// Batch-mark trashed todos done/undone (context-menu toggle action).
// Trash equivalent of useMarkInboxTodo; skips project entries.
export const useMarkTrashTodo = createMutator(
  () => ({}),
  (state, _ctx, todoIds: Set<string>, status: TodoStatus) => {
    for (const entry of state.trash) {
      if (entry.kind !== "todo" || !todoIds.has(entry.id)) continue;
      entry.done = status === "complete";
      recordTodoEdit(entry.id, entry.projId, "trash", { done: status === "complete" });
    }
  },
);

// Permanently delete trash entries (todos + projects). Drives both "empty
// trash" (all entries) and "permanently delete" (selected entries). The server
// hard-deletes by id regardless of placement and cascades a project's rows.
export const usePurgeTrash = createMutator(
  () => ({}),
  (state, _ctx, ids: Set<string>) => {
    if (ids.size === 0) return;
    const removed = state.trash.filter((e) => ids.has(e.id));
    if (removed.length === 0) return;
    state.trash = state.trash.filter((e) => !ids.has(e.id));
    for (const e of removed) {
      if (e.kind === "todo") recordTodoDelete(e.id, null);
      else {
        recordProjDelete(e.id);
        // Drop any signed-out cold-storage copy (no-op when signed in).
        state.stashedProjects.delete(e.id);
      }
    }
  },
);

export const useEditTrashCheck = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, checkId: string, data: Partial<Omit<CheckItem, "id">>) => {
    const entry = state.trash.find((e): e is ArchiveTodoEntry => e.kind === "todo" && e.id === todoId);
    const check = entry?.checks?.find((c) => c.id === checkId);
    if (check == null) return;
    if (data.text !== undefined) check.text = data.text;
    if (data.ticked !== undefined) check.ticked = data.ticked;
    recordCheckEdit(checkId, todoId, null, "trash", {
      ...(data.text !== undefined && { content: data.text }),
      ...(data.ticked !== undefined && { ticked: data.ticked }),
    });
  },
);

export const useMoveTrashCheck = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, checkIds: string[], index: number) => {
    const entry = state.trash.find((e): e is ArchiveTodoEntry => e.kind === "todo" && e.id === todoId);
    if (entry?.checks == null) return;
    const { movingIds, moving } = collectMoving(entry.checks, checkIds);
    if (moving.length === 0) return;
    entry.checks = entry.checks.filter(({ id }) => !movingIds.has(id));
    insert(entry.checks, index, moving);
    recordPlacementCheckOrder(todoId, entry.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i })));
  },
);

export const useCreateInboxCheck = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, items: CheckInitData[], index: number) => {
    const todo = state.inbox.find((t) => t.id === todoId);
    if (todo == null || items.length === 0) return;
    const checks = items.map((item) => newCheckItem(item));
    insert(todo.checks, index, checks);
    for (const c of checks) {
      recordCheckEdit(c.id, todoId, null, "inbox", { content: c.text, ticked: c.ticked });
    }
    recordPlacementCheckOrder(todoId, todo.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i, createHere: checks.some((nc) => nc.id === c.id) })));
  },
);

export const useDeleteInboxCheck = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, checkId: string | Set<string>) => {
    const todo = state.inbox.find((t) => t.id === todoId);
    if (todo == null) return;
    const ids = normalizeIds(checkId);
    todo.checks = todo.checks.filter(({ id }) => !ids.has(id));
    recordPlacementCheckOrder(todoId, todo.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i })));
  },
);

export const useCreateTrashCheck = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, items: CheckInitData[], index: number) => {
    const entry = state.trash.find((e): e is ArchiveTodoEntry => e.kind === "todo" && e.id === todoId);
    if (entry == null || items.length === 0) return;
    entry.checks ??= [];
    const checks = items.map((item) => newCheckItem(item));
    insert(entry.checks, index, checks);
    for (const c of checks) {
      recordCheckEdit(c.id, todoId, null, "trash", { content: c.text, ticked: c.ticked });
    }
    recordPlacementCheckOrder(todoId, entry.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i, createHere: checks.some((nc) => nc.id === c.id) })));
  },
);

export const useDeleteTrashCheck = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, checkId: string | Set<string>) => {
    const entry = state.trash.find((e): e is ArchiveTodoEntry => e.kind === "todo" && e.id === todoId);
    if (entry?.checks == null) return;
    const ids = normalizeIds(checkId);
    entry.checks = entry.checks.filter(({ id }) => !ids.has(id));
    recordPlacementCheckOrder(todoId, entry.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i })));
  },
);

export const useEditArchiveTodo = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, data: Partial<Omit<TodoItem, "checks" | "id" | "status">>) => {
    const entry = state.archive.find((e): e is ArchiveTodoEntry => e.kind === "todo" && e.id === todoId);
    if (entry == null) return;
    if (data.title !== undefined) entry.title = data.title;
    if (data.note !== undefined) entry.note = data.note;
    if (data.planned !== undefined) entry.planned = data.planned ? formatPlanned(data.planned) : null;
    recordTodoEdit(todoId, entry.projId, "archive", {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.note !== undefined && { note: data.note }),
      ...(data.planned !== undefined && { planned: formatPlanned(data.planned) }),
    });
  },
);

// Set/clear the planned date on archived todos (bottom-bar date picker).
// Archive equivalent of useSetPlannedInbox; skips project entries.
export const useSetPlannedArchive = createMutator(
  () => ({}),
  (state, _ctx, todoIds: Set<string>, planned: CalendarDate | null) => {
    for (const entry of state.archive) {
      if (entry.kind !== "todo" || !todoIds.has(entry.id)) continue;
      entry.planned = planned ? formatPlanned(planned) : null;
      recordTodoEdit(entry.id, entry.projId, "archive", { planned: formatPlanned(planned) });
    }
  },
);

export const useEditArchiveCheck = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, checkId: string, data: Partial<Omit<CheckItem, "id">>) => {
    const entry = state.archive.find((e): e is ArchiveTodoEntry => e.kind === "todo" && e.id === todoId);
    const check = entry?.checks?.find((c) => c.id === checkId);
    if (check == null) return;
    if (data.text !== undefined) check.text = data.text;
    if (data.ticked !== undefined) check.ticked = data.ticked;
    recordCheckEdit(checkId, todoId, null, "archive", {
      ...(data.text !== undefined && { content: data.text }),
      ...(data.ticked !== undefined && { ticked: data.ticked }),
    });
  },
);

export const useMoveArchiveCheck = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, checkIds: string[], index: number) => {
    const entry = state.archive.find((e): e is ArchiveTodoEntry => e.kind === "todo" && e.id === todoId);
    if (entry?.checks == null) return;
    const { movingIds, moving } = collectMoving(entry.checks, checkIds);
    if (moving.length === 0) return;
    entry.checks = entry.checks.filter(({ id }) => !movingIds.has(id));
    insert(entry.checks, index, moving);
    recordPlacementCheckOrder(todoId, entry.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i })));
  },
);

export const useCreateArchiveCheck = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, items: CheckInitData[], index: number) => {
    const entry = state.archive.find((e): e is ArchiveTodoEntry => e.kind === "todo" && e.id === todoId);
    if (entry == null || items.length === 0) return;
    entry.checks ??= [];
    const checks = items.map((item) => newCheckItem(item));
    insert(entry.checks, index, checks);
    for (const c of checks) {
      recordCheckEdit(c.id, todoId, null, "archive", { content: c.text, ticked: c.ticked });
    }
    recordPlacementCheckOrder(todoId, entry.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i, createHere: checks.some((nc) => nc.id === c.id) })));
  },
);

export const useDeleteArchiveCheck = createMutator(
  () => ({}),
  (state, _ctx, todoId: string, checkId: string | Set<string>) => {
    const entry = state.archive.find((e): e is ArchiveTodoEntry => e.kind === "todo" && e.id === todoId);
    if (entry?.checks == null) return;
    const ids = normalizeIds(checkId);
    entry.checks = entry.checks.filter(({ id }) => !ids.has(id));
    recordPlacementCheckOrder(todoId, entry.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i })));
  },
);

// ─── Check edits ──────────────────────────────────────────────────────────────

export const useCreateCheck = createMutator(
  () => ({
    ...getProjContext("useCreateCheck: no project context"),
    ...getTodoContext("useCreateCheck: no todo context"),
  }),
  async (state, ctx, items: CheckInitData[], index: number) => {
    const todo = getTodo(state, ctx);
    if (todo == null || items.length === 0) return;
    const checks = items.map((item) => newCheckItem(item));
    insert(todo.checks, index, checks);
    for (const c of checks) {
      recordCheckEdit(c.id, todo.id, ctx.projId, "project", {
        content: c.text,
        ticked: c.ticked,
      });
    }
    recordCheckOrder(
      ctx.projId,
      todo.id,
      todo.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i, createHere: checks.some((nc) => nc.id === c.id) })),
    );
  },
);

export const useEditCheck = createMutator(
  () => ({
    ...getProjContext("useEditCheck: no project context"),
    ...getTodoContext("useEditCheck: no todo context"),
  }),
  (state, ctx, checkId: string, data: Partial<Omit<CheckItem, "id">>) => {
    const todo = getTodo(state, ctx);
    if (todo == null) return;
    const check = todo.checks.find(({ id }) => id === checkId);
    if (check == null) return;
    Object.assign(
      check,
      Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
    );
    recordCheckEdit(checkId, todo.id, ctx.projId, "project", {
      ...(data.text !== undefined && { content: data.text }),
      ...(data.ticked !== undefined && { ticked: data.ticked }),
    });
  },
);

export const useDeleteCheck = createMutator(
  () => ({
    ...getProjContext("useDeleteCheck: no project context"),
    ...getTodoContext("useDeleteCheck: no todo context"),
  }),
  (state, ctx, checkIds: string | Set<string>) => {
    const todo = getTodo(state, ctx);
    if (todo == null) return;
    const ids = normalizeIds(checkIds);
    todo.checks = todo.checks.filter(({ id }) => !ids.has(id));
    // Record deletions via checkOrder with the remaining checks (no createHere).
    // The server handles check deletions via deleteChecks in todoUpdate.
    // For now, we send a check reorder with deleted ones absent.
    recordCheckOrder(
      ctx.projId,
      todo.id,
      todo.checks.map((c, i) => ({ checkId: c.id, startAtIndex: i })),
    );
    // Also record as explicit deletes via todoUpdate.deleteChecks path.
    // We encode these as a scope-level "todoDeleteChecks" but for simplicity
    // we'll use checkOrder (the server interprets absent checks as removed).
    // TODO: wire up explicit deleteChecks in the push body for cleanliness.
  },
);

// ─── Todo creates / deletes ───────────────────────────────────────────────────

export const useCreateTodo = createMutator(
  () => ({
    ...getPanelContext("useCreateTodo: no panel context"),
    ...getProjContext("useCreateTodo: no project context"),
  }),
  async (state, ctx, item?: TodoInitData) => {
    const instance = getProjectInstance(state, ctx);
    if (instance == null) return;
    const insertAt = getInsertIndex(instance);
    const todo = newTodoItem(item);
    insert(instance.project.rows, insertAt, todo);
    instance.rowSelected = { [todo.id]: true };
    instance.todoExpanded = { [todo.id]: true };
    // Record both the field data and the new row order.
    recordTodoEdit(todo.id, ctx.projId, "project", {
      title: todo.title,
      note: todo.note,
      done: todo.status === "complete",
      planned: formatPlanned(todo.planned),
    });
    const newOrder = rowOrderOf(instance.project).map((e) => ({
      ...e,
      ...(e.rowId === todo.id && { createHere: true }),
    }));
    recordRowOrder(ctx.projId, newOrder);
    return { id: todo.id };
  },
);

export const useCreateGrouping = createMutator(
  () => ({
    ...getPanelContext("useCreateGrouping: no panel context"),
    ...getProjContext("useCreateGrouping: no project context"),
  }),
  async (state, ctx, item?: GroupingInitData) => {
    const instance = getProjectInstance(state, ctx);
    if (instance == null) return;
    const insertAt = getInsertIndex(instance);
    const grouping = newGroupingItem(item);
    insert(instance.project.rows, insertAt, grouping);
    instance.rowSelected = { [grouping.id]: true };
    recordGroupEdit(grouping.id, ctx.projId, { label: grouping.label });
    const newOrder = rowOrderOf(instance.project).map((e) => ({
      ...e,
      ...(e.rowId === grouping.id && { createHere: true }),
    }));
    recordRowOrder(ctx.projId, newOrder);
    return { id: grouping.id };
  },
);

export const useEditGrouping = createMutator(
  () => getProjContext("useEditGrouping: no project context"),
  (state, ctx, groupingId: string, data: Partial<Omit<GroupingItem, "id">>) => {
    const project = state.projects.find(({ id }) => id === ctx.projId);
    if (project == null) return;
    const row = project.rows.find(({ id }) => id === groupingId);
    if (row == null || !isGroupingItem(row)) return;
    Object.assign(
      row,
      Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
    );
    if (data.label !== undefined) {
      recordGroupEdit(groupingId, ctx.projId, { label: data.label });
    }
  },
);

export const useDeleteRow = createMutator(
  () => getProjContext("useDeleteRow: no project context"),
  async (state, ctx, rowIds: Set<string>) => {
    const project = state.projects.find(({ id }) => id === ctx.projId);
    if (project == null) return;
    const removed = project.rows.filter(({ id }) => rowIds.has(id));
    project.rows = project.rows.filter(({ id }) => !rowIds.has(id));
    const { projId } = ctx;
    state.panels.forEach((panel) => {
      if (!isProjectInstance(panel.instance)) return;
      if (panel.instance.project.id !== projId) return;
      const { instance } = panel;
      for (const rowId of rowIds) {
        delete instance.rowSelected[rowId];
        delete instance.todoExpanded[rowId];
      }
    });
    for (const r of removed) {
      const kind: "todo" | "group" = isGroupingItem(r) ? "group" : "todo";
      recordRowDelete(projId, r.id, kind);
    }
  },
);

export const useMarkTodo = createMutator(
  () => getProjContext("useMarkTodo: no project context"),
  (state, ctx, todoIds: Set<string>, status: TodoStatus) => {
    const project = state.projects.find(({ id }) => id === ctx.projId);
    if (project == null) return;
    project.rows.forEach((row) => {
      if (isTodoItem(row) && todoIds.has(row.id)) {
        row.status = status;
        recordTodoEdit(row.id, ctx.projId, "project", { done: status === "complete" });
      }
    });
  },
);

export const useSetPlanned = createMutator(
  () => getProjContext("useSetPlanned: no project context"),
  (state, ctx, todoIds: Set<string>, planned: CalendarDate | null) => {
    const project = state.projects.find(({ id }) => id === ctx.projId);
    if (project == null) return;
    project.rows.forEach((row) => {
      if (isTodoItem(row) && todoIds.has(row.id)) {
        row.planned = planned;
        recordTodoEdit(row.id, ctx.projId, "project", { planned: formatPlanned(planned) });
      }
    });
  },
);

// ─── Project creates / edits / deletes ────────────────────────────────────────

export const useCreateProject = createMutator(
  () => getPanelContext("useCreateProject: no panel context"),
  (state, ctx, index: number, item?: ProjectInitData) => {
    const project = newProjectItem(item);
    insert(state.projects, index, project);
    const panel = state.panels.find(({ id }) => id === ctx.panelId);
    if (panel != null) {
      const reactiveProject = state.projects[index];
      panel.instance = newProjectInstance({ project: reactiveProject });
    }
    recordProjCreate(project.id);
    recordProjEdit(project.id, { name: project.name, note: project.note });
    recordProjListOrder(projOrderOf(state));
    return { id: project.id };
  },
);

export const useEditProject = createMutator(
  () => getProjContext("useEditProject: no project context"),
  (state, ctx, data: Partial<Omit<ProjectInitData, "rows" | "id">>) => {
    const project = state.projects.find(({ id }) => id === ctx.projId);
    if (project == null) return;
    Object.assign(
      project,
      Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
    );
    recordProjEdit(ctx.projId, {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.note !== undefined && { note: data.note }),
    });
    // A project opened from a placement view (archive/trash) also has a row in
    // that placement; keep its name in sync so the list reflects the edit.
    const openFrom = state.openProjPlacement.get(ctx.projId);
    if (data.name !== undefined && openFrom != null) {
      const entry = state[openFrom].find((e) => e.kind === "proj" && e.id === ctx.projId);
      if (entry?.kind === "proj") entry.name = data.name;
    }
  },
);

export const useDeleteProject = createMutator(
  () => null,
  async (state, _, projIds: Set<string>) => {
    if (projIds.size === 0) return;
    state.projects = state.projects.filter(({ id }) => !projIds.has(id));
    const fallback = state.projects[0] ?? null;
    state.panels.forEach((panel) => {
      if (!isProjectInstance(panel.instance)) return;
      if (!projIds.has(panel.instance.project.id)) return;
      panel.instance = fallback ? newProjectInstance({ project: fallback }) : newPlacementInstance("inbox");
    });
    for (const id of projIds) recordProjDelete(id);
  },
);

// ─── Placement operations (archive / trash / inbox) ──────────────────────────

export const useArchiveTodo = createMutator(
  () => getProjContext("useArchiveTodo: no project context"),
  (state, ctx, todoIds: Set<string>) => {
    const project = state.projects.find(({ id }) => id === ctx.projId);
    if (project == null) return;
    const archived = project.rows.filter((r) => isTodoItem(r) && todoIds.has(r.id)) as TodoItem[];
    if (archived.length === 0) return;
    project.rows = project.rows.filter((r) => !isTodoItem(r) || !todoIds.has(r.id));
    state.panels.forEach((panel) => {
      if (!isProjectInstance(panel.instance)) return;
      if (panel.instance.project.id !== ctx.projId) return;
      for (const id of todoIds) {
        delete panel.instance.rowSelected[id];
        delete panel.instance.todoExpanded[id];
      }
    });
    for (const todo of archived) {
      recordPlacementMove({ kind: "todo", todoId: todo.id, placement: "archive", associateProjId: ctx.projId });
      state.archive.unshift({
        kind: "todo",
        id: todo.id,
        title: todo.title,
        note: todo.note,
        done: todo.status === "complete",
        planned: todo.planned ? formatPlanned(todo.planned) : null,
        projId: ctx.projId,
        checks: todo.checks,
      });
    }
    recordRowOrder(ctx.projId, rowOrderOf(project));
  },
);

export const useTrashTodo = createMutator(
  () => getProjContext("useTrashTodo: no project context"),
  (state, ctx, todoIds: Set<string>) => {
    const project = state.projects.find(({ id }) => id === ctx.projId);
    if (project == null) return;
    const trashed = project.rows.filter((r) => isTodoItem(r) && todoIds.has(r.id)) as TodoItem[];
    if (trashed.length === 0) return;
    project.rows = project.rows.filter((r) => !isTodoItem(r) || !todoIds.has(r.id));
    state.panels.forEach((panel) => {
      if (!isProjectInstance(panel.instance)) return;
      if (panel.instance.project.id !== ctx.projId) return;
      for (const id of todoIds) {
        delete panel.instance.rowSelected[id];
        delete panel.instance.todoExpanded[id];
      }
    });
    for (const todo of trashed) {
      recordPlacementMove({ kind: "todo", todoId: todo.id, placement: "trash", associateProjId: ctx.projId });
      state.trash.unshift({
        kind: "todo",
        id: todo.id,
        title: todo.title,
        note: todo.note,
        done: todo.status === "complete",
        planned: todo.planned ? formatPlanned(todo.planned) : null,
        projId: ctx.projId,
        checks: todo.checks,
      });
    }
    recordRowOrder(ctx.projId, rowOrderOf(project));
  },
);

export const useArchiveProject = createMutator(
  () => null,
  (state, _, projId: string) => {
    const proj = state.projects.find((p) => p.id === projId);
    if (!proj) return;
    // Signed out there is no server to hold the rows while archived — park the
    // full project locally so reopening it from the archive shows its content
    // with no fetch. Signed in, the server keeps the rows (this stays empty).
    if (syncStatus.pinnedUserId == null) state.stashedProjects.set(projId, proj);
    state.projects = state.projects.filter((p) => p.id !== projId);
    const fallback = state.projects[0] ?? null;
    state.panels.forEach((panel) => {
      if (!isProjectInstance(panel.instance)) return;
      if (panel.instance.project.id !== projId) return;
      panel.instance = fallback ? newProjectInstance({ project: fallback }) : newPlacementInstance("archive");
    });
    recordPlacementMove({ kind: "proj", projId, placement: "archive" });
    state.archive.unshift({ kind: "proj", id: projId, name: proj.name });
    recordProjListOrder(projOrderOf(state));
  },
);

export const useTrashProject = createMutator(
  () => null,
  (state, _, projId: string) => {
    const proj = state.projects.find((p) => p.id === projId);
    if (!proj) return;
    // Signed out there is no server to hold the rows while trashed — park the
    // full project locally so reopening it from the trash shows its content with
    // no fetch. Signed in, the server keeps the rows (this stays empty).
    if (syncStatus.pinnedUserId == null) state.stashedProjects.set(projId, proj);
    state.projects = state.projects.filter((p) => p.id !== projId);
    const fallback = state.projects[0] ?? null;
    state.panels.forEach((panel) => {
      if (!isProjectInstance(panel.instance)) return;
      if (panel.instance.project.id !== projId) return;
      panel.instance = fallback ? newProjectInstance({ project: fallback }) : newPlacementInstance("trash");
    });
    recordPlacementMove({ kind: "proj", projId, placement: "trash" });
    state.trash.unshift({ kind: "proj", id: projId, name: proj.name });
    recordProjListOrder(projOrderOf(state));
  },
);

export const useMoveToInbox = createMutator(
  () => getProjContext("useMoveToInbox: no project context"),
  (state, ctx, todoIds: Set<string>) => {
    const project = state.projects.find(({ id }) => id === ctx.projId);
    if (project == null) return;
    const moved = project.rows.filter((r) => isTodoItem(r) && todoIds.has(r.id)) as TodoItem[];
    if (moved.length === 0) return;
    project.rows = project.rows.filter((r) => !isTodoItem(r) || !todoIds.has(r.id));
    for (const todo of moved) {
      recordPlacementMove({ kind: "todo", todoId: todo.id, placement: "inbox" });
      state.inbox.push({ ...todo });
    }
    recordRowOrder(ctx.projId, rowOrderOf(project));
  },
);

export const useMoveProjectBetweenPlacements = createMutator(
  () => null,
  (
    state,
    _,
    fromPlacement: "archive" | "trash",
    projIds: Set<string>,
    toPlacement: "archive" | "trash",
  ) => {
    if (projIds.size === 0 || fromPlacement === toPlacement) return;
    const src = fromPlacement === "archive" ? state.archive : state.trash;
    const moving = src.filter((e) => e.kind === "proj" && projIds.has(e.id));
    if (moving.length === 0) return;
    const next = src.filter((e) => !(e.kind === "proj" && projIds.has(e.id)));
    if (fromPlacement === "archive") state.archive = next;
    else state.trash = next;
    for (const entry of moving) {
      if (entry.kind !== "proj") continue;
      recordPlacementMove({ kind: "proj", projId: entry.id, placement: toPlacement });
      const dst = toPlacement === "archive" ? state.archive : state.trash;
      dst.unshift({ kind: "proj", id: entry.id, name: entry.name });
    }
  },
);

export const useMovePlacementToPlacement = createMutator(
  () => null,
  (
    state,
    _,
    fromPlacement: "inbox" | "archive" | "trash",
    todoIds: Set<string>,
    toPlacement: "inbox" | "archive" | "trash",
  ) => {
    if (todoIds.size === 0 || fromPlacement === toPlacement) return;

    const moved: TodoItem[] = [];
    const associateProjId: Record<string, string | null> = {};

    if (fromPlacement === "inbox") {
      for (const t of state.inbox) {
        if (todoIds.has(t.id)) {
          moved.push({ ...t });
          associateProjId[t.id] = null;
        }
      }
      state.inbox = state.inbox.filter((t) => !todoIds.has(t.id));
    } else {
      const src = fromPlacement === "archive" ? state.archive : state.trash;
      for (const e of src) {
        if (e.kind !== "todo" || !todoIds.has(e.id)) continue;
        moved.push({
          id: e.id,
          title: e.title,
          note: e.note,
          status: e.done ? "complete" : "todo",
          planned: parsePlanned(e.planned),
          checks: e.checks ?? [],
        });
        associateProjId[e.id] = e.projId;
      }
      const next = src.filter((e) => !(e.kind === "todo" && todoIds.has(e.id)));
      if (fromPlacement === "archive") state.archive = next;
      else state.trash = next;
    }

    if (moved.length === 0) return;

    for (const todo of moved) {
      if (toPlacement === "inbox") {
        recordPlacementMove({ kind: "todo", todoId: todo.id, placement: "inbox" });
        state.inbox.unshift({ ...todo });
      } else {
        const assoc = associateProjId[todo.id];
        recordPlacementMove({
          kind: "todo",
          todoId: todo.id,
          placement: toPlacement,
          ...(assoc != null && { associateProjId: assoc }),
        });
        const entry = {
          kind: "todo" as const,
          id: todo.id,
          title: todo.title,
          note: todo.note,
          done: todo.status === "complete",
          planned: todo.planned ? formatPlanned(todo.planned) : null,
          projId: assoc,
          checks: todo.checks,
        };
        if (toPlacement === "archive") state.archive.unshift(entry);
        else state.trash.unshift(entry);
      }
    }
  },
);

export const useMoveToPlacementFrom = createMutator(
  () => null,
  (state, _, fromProjId: string, todoIds: Set<string>, placement: "inbox" | "archive" | "trash") => {
    const project = state.projects.find(({ id }) => id === fromProjId);
    if (project == null) return;
    const moved = project.rows.filter((r) => isTodoItem(r) && todoIds.has(r.id)) as TodoItem[];
    if (moved.length === 0) return;
    project.rows = project.rows.filter((r) => !isTodoItem(r) || !todoIds.has(r.id));
    state.panels.forEach((panel) => {
      if (!isProjectInstance(panel.instance)) return;
      if (panel.instance.project.id !== fromProjId) return;
      for (const id of todoIds) {
        delete panel.instance.rowSelected[id];
        delete panel.instance.todoExpanded[id];
      }
    });
    for (const todo of moved) {
      if (placement === "inbox") {
        recordPlacementMove({ kind: "todo", todoId: todo.id, placement: "inbox" });
        state.inbox.unshift({ ...todo });
      } else {
        recordPlacementMove({ kind: "todo", todoId: todo.id, placement, associateProjId: fromProjId });
        const entry = { kind: "todo" as const, id: todo.id, title: todo.title, note: todo.note, done: todo.status === "complete", planned: todo.planned ? formatPlanned(todo.planned) : null, projId: fromProjId, checks: todo.checks };
        if (placement === "archive") state.archive.unshift(entry);
        else state.trash.unshift(entry);
      }
    }
    recordRowOrder(fromProjId, rowOrderOf(project));
  },
);
