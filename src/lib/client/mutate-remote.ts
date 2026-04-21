import {
  isTodoItem,
  isProjectInstance,
  newProjectInstance,
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
    }
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
  },
);

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
  },
);

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
  },
);

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
  },
);

export const useDeleteRow = createMutator(
  () => getProjContext("useDeleteRow: no project context"),
  async (state, ctx, rowIds: Set<string>) => {
    const project = state.projects.find(({ id }) => id === ctx.projId);
    if (project == null) return;
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
      }
    });
  },
);

export const useCreateProject = createMutator(
  () => getPanelContext("useCreateProject: no panel context"),
  (state, ctx, index: number, item?: ProjectInitData) => {
    const project = newProjectItem(item);
    insert(state.projects, index, project);
    const panel = state.panels.find(({ id }) => id === ctx.panelId);
    if (panel != null) {
      panel.instance = newProjectInstance({ project });
    }
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
      panel.instance = fallback ? newProjectInstance({ project: fallback }) : "inbox";
    });
  },
);
