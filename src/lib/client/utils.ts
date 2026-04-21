import {
  isGroupingItem,
  isProjectInstance,
  isTodoItem,
  type PanelItem,
  type ProjectInstance,
  type ProjectItem,
  type TodoItem,
} from "$lib/client/model";
import type { PanelContext, ProjContext, TodoContext } from "./context";

type PanelState = {
  panels: PanelItem[];
};

type ProjectState = {
  projects: ProjectItem[];
};

export const normalizeIds = (Ids: string | Set<string> | string[] | null): Set<string> => {
  if (Ids == null) return new Set();
  if (typeof Ids === "string") return new Set([Ids]);
  return Ids instanceof Set ? Ids : new Set(Ids);
};

export const getProjectInstance = (
  state: PanelState,
  ctx: PanelContext & ProjContext,
): ProjectInstance | null => {
  const { panelId, projId } = ctx;
  const panel = state.panels.find(({ id }) => id === panelId);
  if (panel == null) return null;
  const { instance } = panel;
  if (!isProjectInstance(instance)) return null;
  if (instance.project.id !== projId) return null;
  return instance;
};

export const getTodo = (state: ProjectState, ctx: ProjContext & TodoContext): TodoItem | null => {
  const project = state.projects.find(({ id }) => id === ctx.projId);
  if (project == null) return null;
  const row = project.rows.find(({ id }) => id === ctx.rowId);
  if (row == null || !isTodoItem(row)) return null;
  return row;
};

export const insert = <T>(arr: T[], index: number, items: T | T[]) => {
  const insertAt = Math.max(0, Math.min(index, arr.length));
  if (Array.isArray(items)) {
    arr.splice(insertAt, 0, ...items);
    return;
  }
  arr.splice(insertAt, 0, items);
};

export const collectMoving = <T extends { id: string }>(items: T[], ids: string[]) => {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const movingIds = new Set<string>();
  const moving = ids.flatMap((id) => {
    const item = itemById.get(id);
    if (item == null) return [];
    movingIds.add(id);
    return [item];
  });
  return { movingIds, moving };
};

export const getInsertIndex = (instance: ProjectInstance) => {
  const { rows } = instance.project;
  const { rowSelected } = instance;
  let lastSelectedIndex = -1;
  let firstGroupingIndex = -1;
  for (const [i, row] of rows.entries()) {
    if (rowSelected[row.id]) {
      lastSelectedIndex = i;
    }
    if (firstGroupingIndex < 0 && isGroupingItem(row)) {
      firstGroupingIndex = i;
    }
  }
  return lastSelectedIndex >= 0
    ? lastSelectedIndex + 1
    : firstGroupingIndex >= 0
      ? firstGroupingIndex
      : rows.length;
};
