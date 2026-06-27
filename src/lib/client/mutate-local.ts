import {
  isTodoItem,
  isProjectInstance,
  isPlacementInstance,
  newPanelItem,
  newProjectInstance,
  newPlacementInstance,
  operationToInstance,
  type AppState,
  type Instance,
  type OperationInstance,
  type PanelLayout,
} from "$lib/client/model";
import { createMutator, getPanelContext, getProjContext } from "./context";
import { getProjectInstance, normalizeIds } from "./utils";
import { syncStatus } from "./sync.svelte";

const MAX_PANEL_COUNT = 3;

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

export const useClosePanel = createMutator(getPanelContext, (state, ctx) => {
  const panelIndex = state.panels.findIndex(({ id }) => id === ctx.panelId);
  if (panelIndex <= 0) return;
  if (state.panels.length <= 1) return;
  state.panels.splice(panelIndex, 1);
  pruneOrphanPlacementProjects(state);
});

export const useClonePanel = createMutator(getPanelContext, (state, ctx) => {
  const panelIndex = state.panels.findIndex(({ id }) => id === ctx.panelId);
  if (panelIndex === -1) return;
  const { layout, instance } = state.panels[panelIndex];
  const spacerLeft = state.panels.at(panelIndex + 1)?.layout.spacerLeft ?? undefined;
  if (state.panels.length >= MAX_PANEL_COUNT) {
    state.panels.splice(state.panels.length - 1, 1);
  }
  const { height } = layout;
  // Inherit the source panel's height, but give the new panel a default width.
  // spacerLeft inherits the gap that preceded the original next panel (default
  // when there was none).
  state.panels.splice(
    panelIndex + 1,
    0,
    newPanelItem({
      layout: { height, spacerLeft },
      instance: isProjectInstance(instance)
        ? newProjectInstance({ project: instance.project })
        : isPlacementInstance(instance)
          ? newPlacementInstance(instance.kind)
          : instance,
    }),
  );
});

export const useSetProjInPanel = createMutator(getPanelContext, (state, ctx, projId: string) => {
  const panel = state.panels.find(({ id }) => id === ctx.panelId);
  if (panel == null) return;
  const project = state.projects.find(({ id }) => id === projId);
  if (project == null) return;
  panel.instance = newProjectInstance({ project });
  pruneOrphanPlacementProjects(state);
});

// Open a project or operation in a fresh panel inserted right after this one,
// instead of replacing this panel's instance (see useSetProjInPanel /
// useSetOperationInPanel). Mirrors useClonePanel's layout inheritance: keep this
// panel's height, take a default width, and inherit the gap that preceded the
// original next panel.
export const useOpenInNewPanel = createMutator(
  getPanelContext,
  (state, ctx, target: { projId: string } | { op: OperationInstance }) => {
    const panelIndex = state.panels.findIndex(({ id }) => id === ctx.panelId);
    if (panelIndex === -1) return;
    // Resolve what to open before mutating panels, so a missing project bails
    // out without having evicted anything. Projects resolve by id to the
    // reactive object in state (like useSetProjInPanel); operations don't.
    let instance: Instance;
    if ("projId" in target) {
      const project = state.projects.find(({ id }) => id === target.projId);
      if (project == null) return;
      instance = newProjectInstance({ project });
    } else {
      instance = operationToInstance(target.op);
    }
    const { height } = state.panels[panelIndex].layout;
    const spacerLeft = state.panels.at(panelIndex + 1)?.layout.spacerLeft ?? undefined;
    if (state.panels.length >= MAX_PANEL_COUNT) {
      state.panels.splice(state.panels.length - 1, 1);
    }
    state.panels.splice(
      panelIndex + 1,
      0,
      newPanelItem({ layout: { height, spacerLeft }, instance }),
    );
  },
);

export const useSetOperationInPanel = createMutator(
  getPanelContext,
  (state, ctx, instance: OperationInstance) => {
    const panel = state.panels.find(({ id }) => id === ctx.panelId);
    if (panel == null) return;
    panel.instance = operationToInstance(instance);
    pruneOrphanPlacementProjects(state);
  },
);

// ─── Placement-project drill-in ──────────────────────────────────────────────
// Open a project living in a placement view (archive/trash) as a normal,
// fully-editable project page in this panel. Signed out, its full content is
// parked in `stashedProjects` — pull it back so the page opens with its rows and
// no fetch. Signed in, we register a name-only placeholder into `projects` and
// mark it a stub: the panel switches to the project page immediately (showing
// the "Back to …" bar + a Loading… placeholder) and the lazy loader fetches its
// content from the server on demand. Its origin placement is tracked in
// `openProjPlacement` so it stays out of the active project list (see
// projOrderOf / sidebar / switcher) and so "back" returns to the right view.

export const useOpenPlacementProject = createMutator(
  getPanelContext,
  (state, ctx, projId: string, name: string, placement: "archive" | "trash") => {
    const panel = state.panels.find(({ id }) => id === ctx.panelId);
    if (panel == null) return;
    if (!state.projects.some((p) => p.id === projId)) {
      const stashed = state.stashedProjects.get(projId);
      if (stashed) {
        // Signed out: the parked project (with its rows) is right here — open it
        // directly. No stub, so no fetch and no loading indicator.
        state.projects.push(stashed);
      } else {
        state.projects.push({ id: projId, name, note: "", rows: [] });
        // A stub means "awaiting the server's copy of the rows", which the lazy
        // loader pulls. Signed out there is no server (pullProj is a no-op), so a
        // stub would just flash the loading indicator over a fetch that never
        // happens — open the (empty) placeholder directly instead.
        if (syncStatus.pinnedUserId != null) state.projStub[projId] = true;
      }
    }
    state.openProjPlacement.set(projId, placement);
    const reactive = state.projects.find((p) => p.id === projId)!;
    panel.instance = newProjectInstance({ project: reactive });
  },
);

export const useExitPlacementProject = createMutator(getPanelContext, (state, ctx) => {
  const panel = state.panels.find(({ id }) => id === ctx.panelId);
  if (panel == null || !isProjectInstance(panel.instance)) return;
  const projId = panel.instance.project.id;
  const placement = state.openProjPlacement.get(projId) ?? "trash";
  // Return to the placement view with the project row we drilled into preselected
  // so the view can reveal it (as if arrow-navigated to), instead of rendering
  // fresh. Harmless if the row was purged meanwhile — it just matches nothing.
  panel.instance = newPlacementInstance(placement, new Set([projId]));
  pruneOrphanPlacementProjects(state);
});

// Drop any placement-opened project no panel is showing anymore — both from the
// map and from `projects` (it only lived there to back the open project view).
const pruneOrphanPlacementProjects = (state: AppState) => {
  if (state.openProjPlacement.size === 0) return;
  const shown = new Set(
    state.panels.flatMap((p) =>
      isProjectInstance(p.instance) ? [p.instance.project.id] : [],
    ),
  );
  const orphans = new Set([...state.openProjPlacement.keys()].filter((id) => !shown.has(id)));
  if (orphans.size === 0) return;
  for (const id of orphans) {
    state.openProjPlacement.delete(id);
    delete state.projStub[id];
  }
  state.projects = state.projects.filter((p) => !orphans.has(p.id));
};

// Placement view (inbox/archive/trash) row UI state lives on the panel's
// instance, so it is per-panel and dies when the instance is replaced. These
// mutators replace the whole selection / expanded id; callers compute the next
// value from the (read-only) instance prop.
export const useSetPlacementSelected = createMutator(
  getPanelContext,
  (state, ctx, selected: Set<string>) => {
    const panel = state.panels.find(({ id }) => id === ctx.panelId);
    if (panel == null || !isPlacementInstance(panel.instance)) return;
    panel.instance.selected = selected;
  },
);

export const useSetPlacementExpanded = createMutator(
  getPanelContext,
  (state, ctx, expandedId: string | null) => {
    const panel = state.panels.find(({ id }) => id === ctx.panelId);
    if (panel == null || !isPlacementInstance(panel.instance)) return;
    panel.instance.expandedId = expandedId;
  },
);

// Cloud / account button: if a panel is already showing the account op,
// nothing to do. Otherwise open a new panel for it (evicting the oldest
// non-main panel if we'd exceed MAX_PANEL_COUNT).
export const useOpenAccountPanel = createMutator(
  () => null,
  (state) => {
    const existIdx = state.panels.findIndex((p) => p.instance === "account");
    if (existIdx >= 0) {
      state.panels.splice(existIdx, 1);
    }
    if (state.panels.length >= MAX_PANEL_COUNT) {
      // Drop the last non-main panel to make room.
      state.panels.splice(state.panels.length - 1, 1);
    }
    const { height } = state.panels[0].layout;
    // Inherit the first panel's height, default the width, and inherit the gap
    // that preceded the original second panel (default when there was none).
    const spacerLeft = state.panels.at(1)?.layout.spacerLeft ?? undefined;
    state.panels.splice(
      1,
      0,
      newPanelItem({
        instance: "account",
        layout: { height, spacerLeft },
      }),
    );
  },
);
