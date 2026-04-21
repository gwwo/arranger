import {
  isTodoItem,
  isProjectInstance,
  newPanelItem,
  newProjectInstance,
  type OperationInstance,
  type PanelLayout,
} from "$lib/client/model";
import {
  createMutator,
  getPanelContext,
  getProjContext,
} from "./context";
import { getProjectInstance, normalizeIds } from "./utils";

const PANEL_LAYOUT_STORAGE_PREFIX = "panel-layout:";
const MAX_PANEL_COUNT = 3;

export const persistPanelLayout = (panelId: string, layout: PanelLayout) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(`${PANEL_LAYOUT_STORAGE_PREFIX}${panelId}`, JSON.stringify(layout));
};

export const useUpdateLayout = createMutator(
  getPanelContext,
  (state, ctx, data: Partial<PanelLayout>) => {
    const { panelId } = ctx;
    const layout = state.panels.find((p) => p.id === panelId)?.layout;
    if (layout == null) return;
    Object.assign(
      layout,
      Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
    );
  },
);

export const useSetRowSelected = createMutator(
  () => ({ ...getPanelContext(), ...getProjContext() }),
  (state, ctx, rowIds: string | Set<string> | null) => {
    const instance = getProjectInstance(state, ctx);
    if (instance == null) return;
    const selected: Record<string, boolean> = {};
    for (const rowId of normalizeIds(rowIds)) {
      selected[rowId] = true;
    }
    instance.rowSelected = selected;
  },
);

export const useSelectRow = createMutator(
  () => ({ ...getPanelContext(), ...getProjContext() }),
  (state, ctx, rowIds: string | Set<string>) => {
    const instance = getProjectInstance(state, ctx);
    if (instance == null) return;
    for (const rowId of normalizeIds(rowIds)) {
      instance.rowSelected[rowId] = true;
    }
  },
);

export const useUnselectRow = createMutator(
  () => ({ ...getPanelContext(), ...getProjContext() }),
  (state, ctx, rowIds: string | Set<string>) => {
    const instance = getProjectInstance(state, ctx);
    if (instance == null) return;
    for (const rowId of normalizeIds(rowIds)) {
      delete instance.rowSelected[rowId];
    }
  },
);

export const useSetTodoExpanded = createMutator(
  () => ({ ...getPanelContext(), ...getProjContext() }),
  (state, ctx, rowIds: string | Set<string>) => {
    const instance = getProjectInstance(state, ctx);
    if (instance == null) return;
    const expanded: Record<string, boolean> = {};
    for (const rowId of normalizeIds(rowIds)) {
      const row = instance.project.rows.find(({ id }) => id === rowId);
      if (row && isTodoItem(row)) {
        expanded[rowId] = true;
      }
    }
    instance.todoExpanded = expanded;
  },
);

export const useExpandTodo = createMutator(
  () => ({ ...getPanelContext(), ...getProjContext() }),
  (state, ctx, rowIds: string | Set<string>) => {
    const instance = getProjectInstance(state, ctx);
    if (instance == null) return;
    for (const rowId of normalizeIds(rowIds)) {
      const row = instance.project.rows.find(({ id }) => id === rowId);
      if (row && isTodoItem(row)) {
        instance.todoExpanded[rowId] = true;
      }
    }
  },
);

export const useUnexpandTodo = createMutator(
  () => ({ ...getPanelContext(), ...getProjContext() }),
  (state, ctx, rowIds: string | string[]) => {
    const instance = getProjectInstance(state, ctx);
    if (instance == null) return;
    for (const rowId of normalizeIds(rowIds)) {
      delete instance.todoExpanded[rowId];
    }
  },
);

export const useClosePanel = createMutator(
  getPanelContext,
  (state, ctx) => {
    const panelIndex = state.panels.findIndex(({ id }) => id === ctx.panelId);
    if (panelIndex <= 0) return;
    if (state.panels.length <= 1) return;
    state.panels.splice(panelIndex, 1);
  },
);

export const useClonePanel = createMutator(
  getPanelContext,
  (state, ctx) => {
    const panelIndex = state.panels.findIndex(({ id }) => id === ctx.panelId);
    if (panelIndex === -1) return;
    const { layout, instance } = state.panels[panelIndex];
    const spacerLeft = state.panels.at(panelIndex + 1)?.layout.spacerLeft ?? undefined;
    if (state.panels.length >= MAX_PANEL_COUNT) {
      state.panels.splice(state.panels.length - 1, 1);
    }
    const { height, mainWidth } = layout;
    state.panels.splice(
      panelIndex + 1,
      0,
      newPanelItem({
        layout: { height, mainWidth, spacerLeft },
        instance: isProjectInstance(instance)
          ? newProjectInstance({ project: instance.project })
          : instance,
      }),
    );
  },
);

export const useSetProjInPanel = createMutator(
  getPanelContext,
  (state, ctx, projId: string) => {
    const panel = state.panels.find(({ id }) => id === ctx.panelId);
    if (panel == null) return;
    const project = state.projects.find(({ id }) => id === projId);
    if (project == null) return;
    panel.instance = newProjectInstance({ project });
  },
);

export const useSetOperationInPanel = createMutator(
  getPanelContext,
  (state, ctx, instance: OperationInstance) => {
    const panel = state.panels.find(({ id }) => id === ctx.panelId);
    if (panel == null) return;
    panel.instance = instance;
  },
);
