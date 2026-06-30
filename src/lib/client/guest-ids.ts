// At sign-up the guest's demo entities still carry deterministic `guest-` ids
// (see mock.ts). Those ids are identical for every guest, but entity ids are a
// global primary key — so before uploading the guest's state we rewrite every
// `guest-` id (and all references to it) to a fresh UUID, both in local state
// and, by extension, in what gets pushed. Entities the guest created during the
// session already have random UUIDs and are left untouched.

import { GUEST_ID_PREFIX } from "./mock";
import {
  isPlacementInstance,
  isProjectInstance,
  newPlacementInstance,
  newProjectInstance,
  type AppState,
  type ProjectItem,
  type TodoItem,
} from "./model";

export const materializeGuestIds = (appState: AppState): void => {
  // Cached by old id, so a `guest-` id and every reference to it (projId,
  // map keys, row-selection keys, …) all resolve to the same fresh UUID
  // regardless of visitation order.
  const idMap = new Map<string, string>();
  const remap = (id: string): string => {
    if (!id.startsWith(GUEST_ID_PREFIX)) return id;
    let next = idMap.get(id);
    if (next === undefined) {
      next = crypto.randomUUID();
      idMap.set(id, next);
    }
    return next;
  };

  const remapRecordKeys = <T>(rec: Record<string, T>): Record<string, T> => {
    const next: Record<string, T> = {};
    for (const [k, v] of Object.entries(rec)) next[remap(k)] = v;
    return next;
  };

  const remapProject = (proj: ProjectItem): void => {
    proj.id = remap(proj.id);
    for (const row of proj.rows) {
      row.id = remap(row.id);
      if ("checks" in row) {
        for (const check of row.checks) check.id = remap(check.id);
      }
    }
  };

  const remapTodo = (todo: TodoItem): void => {
    todo.id = remap(todo.id);
    for (const check of todo.checks) check.id = remap(check.id);
  };

  // Active + drilled-in projects. Panel project instances share these object
  // references, so mutating ids here updates the instances too.
  for (const proj of appState.projects) remapProject(proj);

  // Placement views.
  for (const todo of appState.inbox) remapTodo(todo);
  for (const list of [appState.archive, appState.trash]) {
    for (const entry of list) {
      entry.id = remap(entry.id);
      if (entry.kind === "todo") {
        if (entry.projId != null) entry.projId = remap(entry.projId);
        for (const check of entry.checks ?? []) check.id = remap(check.id);
      }
    }
  }

  // Guest cold storage for archived/trashed project content (keyed by proj id).
  const stashed = new Map<string, ProjectItem>();
  for (const [, proj] of appState.stashedProjects) {
    remapProject(proj);
    stashed.set(proj.id, proj);
  }
  appState.stashedProjects = stashed;

  // Id-keyed bookkeeping.
  const openPlacement = new Map<string, "archive" | "trash">();
  for (const [k, v] of appState.openProjPlacement) openPlacement.set(remap(k), v);
  appState.openProjPlacement = openPlacement;
  appState.projStub = remapRecordKeys(appState.projStub);

  // Panels: recreate each project/placement instance as a NEW object (with its
  // per-panel UI state remapped to the new ids). The panel's view is wrapped in
  // `{#key displayed}` (Panel.svelte), so swapping in a new instance cleanly
  // remounts its row list against the remapped data. Mutating ids in place keeps
  // the same instance identity — no remount — leaving the live, id-keyed drag
  // list desynced (rows re-enter but become un-interactive until you switch
  // projects). The panel `id` is left untouched: it's a client-only `{#each}` key
  // never sent to the server, and keeping it stable lets a panel transform in
  // place (e.g. the account panel switches Welcome → signed-in) without being
  // torn down.
  for (const panel of appState.panels) {
    const inst = panel.instance;
    if (isProjectInstance(inst)) {
      panel.instance = newProjectInstance({
        project: inst.project,
        rowSelected: remapRecordKeys(inst.rowSelected),
        todoExpanded: remapRecordKeys(inst.todoExpanded),
      });
    } else if (isPlacementInstance(inst)) {
      panel.instance = newPlacementInstance(
        inst.kind,
        new Set([...inst.selected].map(remap)),
        inst.expandedId != null ? remap(inst.expandedId) : null,
      );
    }
  }
};
