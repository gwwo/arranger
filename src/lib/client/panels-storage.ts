// Per-user persistence of the open panels (layout + which project/operation
// each shows). Keyed by user id so swapping accounts doesn't cross-pollute.
//
// Guests (userId == null) are skipped: mock project IDs are regenerated
// every page load, so a saved project panel would never rehydrate cleanly.

import {
  isPlacementInstance,
  isProjectInstance,
  newPlacementInstance,
  newProjectInstance,
  type Instance,
  type PlacementName,
  type SimpleOperation,
  type PanelItem,
  type PanelLayout,
  type ProjectItem,
} from "./model";

const STORAGE_PREFIX = "panels:";

const keyFor = (userId: string | null): string | null =>
  userId == null ? null : `${STORAGE_PREFIX}${userId}`;

type SerializedProjectInstance = {
  kind: "project";
  projectId: string;
  rowSelected: Record<string, boolean>;
  todoExpanded: Record<string, boolean>;
  // Origin placement when this is a project drilled-into from archive/trash.
  // Such projects aren't in the active project list after a reload, so on load
  // we fall back to the placement view rather than dropping the panel.
  placement?: "archive" | "trash";
};

type SerializedPlacementInstance = {
  kind: PlacementName;
  selected: string[];
  expandedId: string | null;
};

type SerializedInstance =
  | SimpleOperation
  | SerializedProjectInstance
  | SerializedPlacementInstance;

export type SerializedPanel = {
  layout: PanelLayout;
  instance: SerializedInstance;
};

// Set on a restored panel whose instance is a project that was drilled-into
// from archive/trash. Such projects aren't in the bootstrapped active list, so
// the panel is rendered with the placement view as an immediate fallback and
// this carries what's needed to async re-fetch the project and swap it back in.
export type PendingPlacementProject = {
  projectId: string;
  placement: "archive" | "trash";
  rowSelected: Record<string, boolean>;
  todoExpanded: Record<string, boolean>;
};

export type StoredPanelData = {
  layout: PanelLayout;
  instance: Instance;
  pendingPlacementProject?: PendingPlacementProject;
};

const serializeInstance = (
  instance: Instance,
  openProjPlacement: Map<string, "archive" | "trash">,
): SerializedInstance => {
  if (isProjectInstance(instance)) {
    const rowSelected: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(instance.rowSelected)) {
      if (v) rowSelected[k] = true;
    }
    const todoExpanded: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(instance.todoExpanded)) {
      if (v) todoExpanded[k] = true;
    }
    const placement = openProjPlacement.get(instance.project.id);
    return { kind: "project", projectId: instance.project.id, rowSelected, todoExpanded, ...(placement && { placement }) };
  }
  if (isPlacementInstance(instance)) {
    return { kind: instance.kind, selected: [...instance.selected], expandedId: instance.expandedId };
  }
  return instance;
};

// Walks every reactive field we care about. Call this inside an $effect to
// register deep dependencies — Svelte 5's proxies only track fields that
// are actually read.
export const serializePanels = (
  panels: PanelItem[],
  openProjPlacement: Map<string, "archive" | "trash">,
): SerializedPanel[] =>
  panels.map((p) => ({
    layout: {
      mainWidth: p.layout.mainWidth,
      height: p.layout.height,
      sideShow: p.layout.sideShow,
      sideWidth: p.layout.sideWidth,
      spacerLeft: p.layout.spacerLeft,
    },
    instance: serializeInstance(p.instance, openProjPlacement),
  }));

export const clearPanels = (userId: string | null) => {
  const key = keyFor(userId);
  if (key == null) return;
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(key);
};

// Write a pre-serialized payload. Split from serialize so callers can
// gate the write (e.g. skip during initial-hydration tick) while still
// having serialize establish reactive dependencies.
export const writePanels = (userId: string | null, panels: SerializedPanel[]) => {
  const key = keyFor(userId);
  if (key == null) return;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(panels));
  } catch {
    // Quota exhausted — persistence is best-effort.
  }
};

// Returns null when nothing usable is stored (no key, parse error, every
// saved panel referenced a project that no longer exists). Caller should
// fall back to default panel construction in that case.
export const loadPanels = (
  userId: string | null,
  projects: ProjectItem[],
): StoredPanelData[] | null => {
  const key = keyFor(userId);
  if (key == null) return null;
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const projectsById = new Map(projects.map((p) => [p.id, p] as const));
  const restored: StoredPanelData[] = [];
  for (const entry of parsed) {
    if (entry == null || typeof entry !== "object") continue;
    const { layout, instance } = entry as Partial<SerializedPanel>;
    if (layout == null || instance == null) continue;
    let inst: Instance;
    if (typeof instance === "string") {
      inst = instance;
    } else if (typeof instance === "object" && instance.kind === "project") {
      const sp = instance as SerializedProjectInstance;
      const project = projectsById.get(sp.projectId);
      if (project == null) {
        // A project drilled-into from archive/trash: it's no longer in the
        // active list after a reload. Keep the panel (so layout/indexes stay
        // intact) by rendering its origin placement view immediately, and flag
        // it for async re-fetch so the caller can swap the project back in.
        // Only drop it when there's no placement to fall back to.
        if (sp.placement == null) continue;
        restored.push({
          layout,
          instance: newPlacementInstance(sp.placement),
          pendingPlacementProject: {
            projectId: sp.projectId,
            placement: sp.placement,
            rowSelected: sp.rowSelected ?? {},
            todoExpanded: sp.todoExpanded ?? {},
          },
        });
        continue;
      }
      inst = newProjectInstance({
        project,
        rowSelected: sp.rowSelected ?? {},
        todoExpanded: sp.todoExpanded ?? {},
      });
    } else if (typeof instance === "object") {
      const sp = instance as SerializedPlacementInstance;
      inst = newPlacementInstance(sp.kind, new Set(sp.selected ?? []), sp.expandedId ?? null);
    } else {
      continue;
    }
    restored.push({ layout, instance: inst });
  }
  return restored.length > 0 ? restored : null;
};
