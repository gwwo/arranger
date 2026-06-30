<script lang="ts">
  import { ContextMenuPopup, PickerPopup, SwitcherPopup, ConfirmPopup, type ProjectItem } from "$lib";
  import CheckListInsert from "$lib/components/check-list/CheckListInsert.svelte";
  import TodoListInsert from "$lib/components/todo-panel/TodoListInsert.svelte";
  import { onMount, untrack } from "svelte";

  import ProjectListInsert from "$lib/components/project-list/ProjectListInsert.svelte";
  import PanelGroup from "$lib/components/PanelGroup.svelte";
  import Panel from "./Panel.svelte";
  import {
    newPanelItem,
    newProjectInstance,
    newPlacementInstance,
    isProjectInstance,
    isPlacementInstance,
    type Instance,
    type PanelItem,
    type ArchiveEntry,
    type ArchiveProjEntry,
    type TodoItem,
    type PlacementName,
  } from "$lib/client/model";
  import {
    serializePanelComp,
    writePanelCompCookie,
    clearPanelCompCookie,
    type PanelComposition,
  } from "$lib/client/panel-comp";
  import type { PlacementDelta } from "$lib/server/sync/types";
  import { markInteractive } from "$lib/client/interactive";
  import {
    setAppStateContext,
    setAuthHooksContext,
    setSyncHooksContext,
  } from "$lib/client/context";
  import {
    initSync,
    pullProjList,
    pullProj,
    pullPlacement,
    uploadInitialState,
    resetSyncState,
    projsFromListDelta,
    projectFromDelta,
    applyProjDeltaToProject,
    syncStatus,
    syncedAtSeq,
    settle,
    parsePlanned,
  } from "$lib/client/sync.svelte";
  import { newCheckItem } from "$lib";
  import { freshMockProjects, mockPanels, GUEST_ID_PREFIX } from "$lib/client/mock";
  import { materializeGuestIds } from "$lib/client/guest-ids";
  import { clearPanels, loadPanels, serializePanels, writePanels, type StoredPanelData } from "$lib/client/panels-storage";
  import { seedMe, loadMe as loadMeUser } from "$lib/components/user-panel/UserPanel.svelte";
  import type { BootstrapState } from "$lib/client/bootstrap";
  import type { PageProps } from "./$types";

  const { data }: PageProps = $props();

  // ─── Bootstrap helpers ────────────────────────────────────────────────────

  const projectsFromBootstrap = (state: BootstrapState): ProjectItem[] => {
    const projects = state.projList.projects.map((entry) => {
      const delta = state.projContents[entry.id];
      if (!delta) return { id: entry.id, name: entry.name, note: entry.note, rows: [] };
      return projectFromDelta(entry.id, entry.name, entry.note, delta);
    });
    // Projects drilled into from archive/trash were also prefetched but aren't in
    // the active list — build them from their delta (name comes from projFields).
    const activeIds = new Set(state.projList.projects.map((p) => p.id));
    for (const [projId, delta] of Object.entries(state.projContents)) {
      if (activeIds.has(projId)) continue;
      projects.push(
        projectFromDelta(projId, delta.projFields?.name ?? "", delta.projFields?.note ?? "", delta),
      );
    }
    return projects;
  };

  const inboxFromDelta = (delta: PlacementDelta): TodoItem[] =>
    delta.entries
      .filter((e) => e.kind === "todo")
      .map((e) => {
        const t = e as { kind: "todo"; id: string; title: string; note: string; done: boolean; planned: string | null; checks?: { id: string; text: string; ticked: boolean; sortKey: number }[] };
        const checks = (t.checks ?? []).map((c) => ({ ...newCheckItem({ text: c.text, ticked: c.ticked }), id: c.id }));
        return { id: t.id, title: t.title, note: t.note, status: t.done ? "complete" as const : "todo" as const, planned: parsePlanned(t.planned), checks };
      });

  const placementFromDelta = (delta: PlacementDelta): ArchiveEntry[] =>
    delta.entries as ArchiveEntry[];

  // Projects in the list whose content wasn't prefetched start stubbed (name +
  // order known, rows fetched on first open).
  const initProjStub = (): Record<string, boolean> => {
    const stub: Record<string, boolean> = {};
    if (data.state) {
      for (const entry of data.state.projList.projects) {
        if (!data.state.projContents[entry.id]) stub[entry.id] = true;
      }
    }
    return stub;
  };

  // A placement is stubbed when there's a signed-in user but it wasn't
  // prefetched. Guests have no placements, so nothing to load (not stubbed).
  const initPlacementStub = (): Record<PlacementName, boolean> => ({
    inbox: !!(data.state && !data.state.inbox),
    archive: !!(data.state && !data.state.archive),
    trash: !!(data.state && !data.state.trash),
  });

  const seedSyncedAtSeq = (state: BootstrapState) => {
    syncedAtSeq["projList"] = state.projList.newSeq;
    for (const [projId, delta] of Object.entries(state.projContents)) {
      syncedAtSeq[`proj:${projId}`] = delta.newSeq;
    }
    if (state.inbox) syncedAtSeq["inbox"] = state.inbox.newSeq;
    if (state.archive) syncedAtSeq["archive"] = state.archive.newSeq;
    if (state.trash) syncedAtSeq["trash"] = state.trash.newSeq;
  };

  // ─── Initial state ────────────────────────────────────────────────────────
  const projects: ProjectItem[] = $state(
    data.user && data.state ? projectsFromBootstrap(data.state) : freshMockProjects()
  );

  // Stable id for the default main panel so its SSR and hydration `{#each}` keys
  // match (a random id would differ between the two renders). Composition-built
  // panels carry their own ids from the cookie.
  const MAIN_PANEL_ID = "main-panel";

  const makeMainPanel = (projs: ProjectItem[]): PanelItem => {
    const instance: Instance =
      projs.length > 0 ? newProjectInstance({ project: projs[0] }) : newPlacementInstance("inbox");
    return newPanelItem({
      id: MAIN_PANEL_ID,
      instance,
      layout: { sideShow: true, sideWidth: 200, spacerLeft: "disabled" },
    });
  };

  // Rebuild the open panels from the cookie composition (signed-in SSR + first
  // client render, so they agree and hydrate cleanly). Per-row UI state isn't in
  // the composition — it's overlaid from localStorage at hydration. Each project
  // panel resolves its project from the bootstrapped list; a project the server
  // couldn't prefetch (deleted / stale cookie) falls back to its origin placement
  // view, else the panel is dropped — mirroring loadPanels.
  const panelsFromComposition = (
    comp: PanelComposition,
    projs: ProjectItem[],
  ): PanelItem[] => {
    const byId = new Map(projs.map((p) => [p.id, p] as const));
    const out: PanelItem[] = [];
    for (const e of comp) {
      const c = e.content;
      if (c.t === "operation") {
        out.push(newPanelItem({ id: e.id, layout: e.layout, instance: c.op }));
      } else if (c.t === "placement") {
        out.push(newPanelItem({ id: e.id, layout: e.layout, instance: newPlacementInstance(c.name) }));
      } else {
        const project = byId.get(c.projectId);
        if (project) {
          out.push(newPanelItem({ id: e.id, layout: e.layout, instance: newProjectInstance({ project }) }));
        } else if (c.placement) {
          out.push(newPanelItem({ id: e.id, layout: e.layout, instance: newPlacementInstance(c.placement) }));
        }
      }
    }
    return out;
  };

  const ensureMainData = (data: StoredPanelData[], projs: ProjectItem[]): StoredPanelData[] => {
    if (data.length === 0 || data[0].instance === "account") {
      const main = makeMainPanel(projs);
      return [{ layout: main.layout, instance: main.instance }, ...data];
    }
    return data;
  };

  const applyStoredPanels = (panels: PanelItem[], stored: StoredPanelData[]) => {
    while (panels.length > stored.length) panels.pop();
    for (let i = 0; i < Math.min(panels.length, stored.length); i++) {
      panels[i].instance = stored[i].instance;
      Object.assign(panels[i].layout, stored[i].layout);
    }
    while (panels.length < stored.length) {
      const d = stored[panels.length];
      panels.push(newPanelItem({ layout: d.layout, instance: d.instance }));
    }
  };

  // Whether two instances show the same scope (ignoring per-row UI state) — used
  // to decide whether the SSR-built panels already match what localStorage holds.
  const sameContent = (a: Instance, b: Instance): boolean => {
    if (isProjectInstance(a)) return isProjectInstance(b) && a.project.id === b.project.id;
    if (isPlacementInstance(a)) return isPlacementInstance(b) && a.kind === b.kind;
    return a === b; // simple-operation strings
  };

  // True when the SSR-rendered panels (built from the cookie) line up with what
  // localStorage holds — same count, same scope per slot. The common case: the
  // cookie and localStorage are written together so they agree.
  const compositionMatches = (panels: PanelItem[], stored: StoredPanelData[]): boolean =>
    panels.length === stored.length &&
    panels.every((p, i) => sameContent(p.instance, stored[i].instance));

  // Overlay the per-row UI state (kept out of the cookie) from localStorage onto
  // the already-rendered panels. Reassigns the row-state fields only — not the
  // instance object — so the panel view isn't re-keyed/remounted (Panel keys on
  // instance identity); the selection/expansion just lights up reactively.
  const overlayRowState = (panels: PanelItem[], stored: StoredPanelData[]) => {
    for (let i = 0; i < panels.length; i++) {
      const inst = panels[i].instance;
      const si = stored[i].instance;
      if (isProjectInstance(inst) && isProjectInstance(si)) {
        inst.rowSelected = si.rowSelected;
        inst.todoExpanded = si.todoExpanded;
      } else if (isPlacementInstance(inst) && isPlacementInstance(si)) {
        inst.selected = si.selected;
        inst.expandedId = si.expandedId;
      }
    }
  };

  // Re-open projects that were drilled-into from archive/trash. applyStoredPanels
  // rendered each as its origin placement view (so layout/indexes stay correct);
  // here we register a placeholder project + its placement origin and swap the
  // panel to the project view. The project is marked as a stub, so the lazy
  // loader (below) fetches its content and the panel shows the loading
  // placeholder until it arrives — same path as any other not-yet-loaded project.
  const restorePlacementProjects = (panels: PanelItem[], stored: StoredPanelData[]) => {
    for (let i = 0; i < stored.length; i++) {
      const info = stored[i].pendingPlacementProject;
      const panel = panels[i];
      if (info == null || panel == null) continue;
      const list = info.placement === "trash" ? appState.trash : appState.archive;
      const entry = list.find((e) => e.kind === "proj" && e.id === info.projectId) as
        | ArchiveProjEntry
        | undefined;
      // Already present means it was prefetched (cookie hit) — keep it loaded.
      // Otherwise register a placeholder and stub it for the lazy loader.
      if (!appState.projects.some((p) => p.id === info.projectId)) {
        appState.projects.push({ id: info.projectId, name: entry?.name ?? "", note: "", rows: [] });
        // Signed out there is no server to lazy-load from, so don't stub it (a
        // stub would just flash the loading indicator forever); mirrors
        // useOpenPlacementProject.
        if (syncStatus.pinnedUserId != null) appState.projStub[info.projectId] = true;
      }
      appState.openProjPlacement.set(info.projectId, info.placement);
      const project = appState.projects.find((p) => p.id === info.projectId)!;
      if (isPlacementInstance(panel.instance) && panel.instance.kind === info.placement) {
        panel.instance = newProjectInstance({
          project,
          rowSelected: info.rowSelected,
          todoExpanded: info.todoExpanded,
        });
      }
    }
  };

  // ─── Lazy content loading ──────────────────────────────────────────────────
  // Only the scopes the open panels showed are bootstrapped; every other project
  // / placement is a stub fetched the first time a panel shows it. A single
  // effect watches the panels and ensures each shown scope is loaded; the view
  // components render a "Loading…" placeholder while their scope is stubbed.

  // Scopes with a fetch in flight, so the effect doesn't kick a second one. The
  // stub clears the instant data arrives; the loading indicator's keep-previous /
  // delay / min-visible timing is handled by Panel.
  const loadingScopes = new Set<string>();

  const ensureProjectLoaded = (projId: string) => {
    const key = `proj:${projId}`;
    if (loadingScopes.has(key)) return;
    loadingScopes.add(key);
    void (async () => {
      const delta = await pullProj(projId, { full: true });
      const proj = appState.projects.find((p) => p.id === projId);
      if (proj && delta) applyProjDeltaToProject(proj, delta);
      appState.projStub[projId] = false;
      loadingScopes.delete(key);
    })();
  };

  const ensurePlacementLoaded = (kind: PlacementName) => {
    const key = `placement:${kind}`;
    if (loadingScopes.has(key)) return;
    loadingScopes.add(key);
    void (async () => {
      const delta = await pullPlacement(kind);
      if (delta) {
        if (kind === "inbox") appState.inbox = inboxFromDelta(delta);
        else appState[kind] = delta.entries as ArchiveEntry[];
      }
      appState.placementStub[kind] = false;
      loadingScopes.delete(key);
    })();
  };

  const defaultPanels = (): PanelItem[] => {
    if (!data.user) {
      return [
        ...mockPanels(projects),
        newPanelItem({ id: `${GUEST_ID_PREFIX}panel-account`, instance: "account" }),
      ];
    }
    // Signed in: rebuild the panels the cookie says were open, so the server
    // renders them and the client's first render matches. No cookie (first
    // visit) → the default main panel, whose first project the server prefetched.
    if (data.panels) {
      const built = panelsFromComposition(data.panels, projects);
      if (built.length > 0) return built;
    }
    return [makeMainPanel(projects)];
  };

  const appState = $state({
    projects,
    panels: untrack<PanelItem[]>(defaultPanels),
    inbox: data.state?.inbox ? inboxFromDelta(data.state.inbox) : [] as TodoItem[],
    archive: data.state?.archive ? placementFromDelta(data.state.archive) : [] as ArchiveEntry[],
    trash: data.state?.trash ? placementFromDelta(data.state.trash) : [] as ArchiveEntry[],
    openProjPlacement: new Map<string, "archive" | "trash">(
      Object.entries(data.state?.projPlacements ?? {}),
    ),
    stashedProjects: new Map<string, ProjectItem>(),
    projStub: untrack(initProjStub),
    placementStub: untrack(initPlacementStub),
  });
  setAppStateContext(appState);

  let currentUserId: string | null = $state(untrack(() => data.user?.id ?? null));
  let hydrated = $state(false);

  // Persist the full panel state (incl. per-row UI) to localStorage.
  $effect(() => {
    const snapshot = serializePanels(appState.panels, appState.openProjPlacement);
    const userId = currentUserId;
    if (!hydrated) return;
    writePanels(userId, snapshot);
  });

  // Mirror the panel composition (no per-row state) into a cookie so the next
  // SSR can render these panels server-side and prefetch their content. Separate
  // from the localStorage write so it only re-fires on composition changes, not
  // on every row selection. Signed-in only; guests render from the mock panels.
  $effect(() => {
    const comp = serializePanelComp(appState.panels, appState.openProjPlacement);
    const userId = currentUserId;
    if (!hydrated) return;
    if (userId) writePanelCompCookie(comp);
    else clearPanelCompCookie();
  });

  // Watch the open panels and lazily load any stubbed scope they show.
  $effect(() => {
    if (!hydrated) return;
    for (const panel of appState.panels) {
      const inst = panel.instance;
      if (isProjectInstance(inst)) {
        if (appState.projStub[inst.project.id]) ensureProjectLoaded(inst.project.id);
      } else if (isPlacementInstance(inst)) {
        if (appState.placementStub[inst.kind]) ensurePlacementLoaded(inst.kind);
      }
    }
  });

  // ─── Auth wiring ──────────────────────────────────────────────────────────
  async function onAuthChange(userId: string | null, opts?: { newUser?: boolean }) {
    if (userId === currentUserId) return;
    syncStatus.pinnedUserId = userId;
    // The user is genuinely changing, so the prior session's per-scope
    // syncedAtSeq and any queued overlay mutations are no longer valid — clear
    // them before pulling/uploading so they can't leak into the new session.
    resetSyncState();

    if (userId && opts?.newUser) {
      // Sign-up: the demo state still carries deterministic `guest-` ids
      // (identical across all guests) — rewrite them to fresh UUIDs locally
      // before upload so they don't collide on the server's global primary key.
      materializeGuestIds(appState);
      // Upload the current (possibly edited) demo state, then hand the backing
      // store over to the server — drop the guest cold storage so reopening an
      // archived/trashed project fetches the now-uploaded copy (keeps the
      // "signed in ⟹ stash empty" invariant).
      await uploadInitialState(appState);
      appState.stashedProjects = new Map();
    } else if (userId) {
      // Sign-in: pull only the project list, then switch the panels right away.
      // Every project (and placement view) starts as a stub, so the first panel
      // shows the project list in its sidebar with a loading placeholder in its
      // main area while each scope's content is fetched lazily (by the lazy-load
      // effect / view components). This gates the post-sign-in switch on the
      // list alone — the caller (loadMe) also has the user info by now, and
      // holds the account view until this returns so the account panel and the
      // panels flip together — instead of waiting for every project's rows.
      const listDelta = await pullProjList();
      if (!listDelta) return;

      appState.projects = listDelta.projects.map((entry) => ({
        id: entry.id,
        name: entry.name,
        note: entry.note,
        rows: [],
      }));

      // Stub every project and placement view: each loads lazily the first time
      // a panel shows it. The server is now the backing store, so drop the guest
      // cold storage and clear the local placement data (it reloads on demand).
      const projStub: Record<string, boolean> = {};
      for (const entry of listDelta.projects) projStub[entry.id] = true;
      appState.projStub = projStub;
      appState.inbox = [];
      appState.archive = [];
      appState.trash = [];
      appState.placementStub = { inbox: true, archive: true, trash: true };
      appState.stashedProjects = new Map();

      // Signing in from the guest page is a clean transform of what's on screen,
      // not a resurrection of a saved arrangement: keep the guest panels'
      // dimensions/spacing as-is, point the first panel at the first project
      // (which shows its loading placeholder until content streams in), turn the
      // sign-in panel into the account panel, and close any extra panels. The
      // normal signed-in resume — restoring the saved multi-panel arrangement
      // from the panel_comp cookie + localStorage — still happens on a real
      // signed-in page load (SSR + onMount below), not here.
      const proj = appState.projects[0];
      const instance = proj ? newProjectInstance({ project: proj }) : newPlacementInstance("inbox");
      const existingAccount = appState.panels.find(p => p.instance === "account");
      const accountPanel = existingAccount ?? newPanelItem({ instance: "account" });
      if (appState.panels.length > 0) {
        appState.panels[0].instance = instance;
      } else {
        appState.panels.push(newPanelItem({ instance }));
      }
      appState.panels.splice(1, appState.panels.length - 1, accountPanel);
    } else {
      clearPanels(currentUserId);
      clearPanelCompCookie();
      currentUserId = null;
      appState.projects = freshMockProjects();
      appState.inbox = [];
      appState.archive = [];
      appState.trash = [];
      // Guest mock data is fully present — nothing to lazy-load or cold-store.
      appState.projStub = {};
      appState.placementStub = { inbox: false, archive: false, trash: false };
      appState.stashedProjects = new Map();
      const mockData = mockPanels(appState.projects)[0];
      const existingAccount = appState.panels.find(p => p.instance === "account");
      const accountPanel = existingAccount ?? newPanelItem({ instance: "account" });
      if (appState.panels.length > 0) {
        appState.panels[0].instance = mockData.instance;
        Object.assign(appState.panels[0].layout, mockData.layout);
      } else {
        appState.panels.push(newPanelItem({ layout: mockData.layout, instance: mockData.instance }));
      }
      Object.assign(accountPanel.layout, {
        mainWidth: mockData.layout.mainWidth,
        height: mockData.layout.height,
        sideShow: false,
        sideWidth: "disabled",
        spacerLeft: 60,
      });
      appState.panels.splice(1, appState.panels.length - 1, accountPanel);
    }
    currentUserId = userId;
  }

  setAuthHooksContext({ onAuthChange });

  // ─── Refresh ──────────────────────────────────────────────────────────────
  async function refresh() {
    if (syncStatus.pinnedUserId != null) {
      const valid = await loadMeUser();
      if (!valid) {
        syncStatus.error = "Session ended or changed — open account to re-sign in.";
        return;
      }
      syncStatus.error = null;
    }

    // Push any pending mutations first, then pull fresh state.
    await settle();

    const listDelta = await pullProjList();
    if (!listDelta) return;

    // Update or add projects from list.
    const knownIds = new Set(appState.projects.map((p) => p.id));
    const newProjects = projsFromListDelta(listDelta, appState.projects);

    // Projects new to this client (created elsewhere) arrive name-only — stub
    // them so their content loads lazily if/when a panel opens them.
    for (const np of newProjects) {
      if (!knownIds.has(np.id)) appState.projStub[np.id] = true;
    }

    // Preserve projects opened from a placement view (archive/trash, so not in
    // the list delta) — dropping them here would close/reset the panel mid-edit.
    for (const p of appState.projects) {
      if (appState.openProjPlacement.has(p.id) && !newProjects.some((np) => np.id === p.id)) {
        newProjects.push(p);
      }
    }

    // Pull a delta for each open project that's already loaded. Closed or
    // stubbed projects are skipped — they load fresh when first opened.
    const openProjIds = new Set(
      appState.panels
        .map((p) => (isProjectInstance(p.instance) ? p.instance.project.id : null))
        .filter(Boolean) as string[]
    );

    await Promise.all(
      newProjects.map(async (proj) => {
        if (!openProjIds.has(proj.id) || appState.projStub[proj.id]) return;
        const delta = await pullProj(proj.id);
        if (delta) applyProjDeltaToProject(proj, delta);
      })
    );

    appState.projects = newProjects;

    // Re-point panels at the freshly pulled reactive projects.
    const projectsById = new Map(appState.projects.map((p) => [p.id, p] as const));
    for (let i = appState.panels.length - 1; i >= 0; i--) {
      const panel = appState.panels[i];
      const inst = panel.instance;
      if (!isProjectInstance(inst)) continue;
      const proj = projectsById.get(inst.project.id);
      if (proj == null) {
        if (i > 0) {
          appState.panels.splice(i, 1);
        } else {
          panel.instance = appState.projects[0]
            ? newProjectInstance({ project: appState.projects[0] })
            : newPlacementInstance("inbox");
        }
        continue;
      }
      panel.instance = newProjectInstance({
        project: proj,
        rowSelected: inst.rowSelected,
        todoExpanded: inst.todoExpanded,
      });
    }

    // Refresh only placement views that are already loaded; stubbed ones load
    // fresh when first opened.
    const refreshPlacement = async (kind: PlacementName) => {
      if (appState.placementStub[kind]) return;
      const delta = await pullPlacement(kind);
      if (!delta) return;
      if (kind === "inbox") appState.inbox = inboxFromDelta(delta);
      else appState[kind] = delta.entries as ArchiveEntry[];
    };
    await Promise.all([
      refreshPlacement("inbox"),
      refreshPlacement("archive"),
      refreshPlacement("trash"),
    ]);
  }
  setSyncHooksContext({ refresh });

  // Seed the requesting user's own, request-scoped state during render (server +
  // the client's first render) so the page server-renders its real, signed-in
  // shape instead of a flash that only resolves after hydration — as safe to SSR
  // as the project data, which is equally request-scoped.
  //  - `me`: the account panel renders the real account / Welcome view, not
  //    "Loading…". seedMe re-seeds per request on the server (see its note).
  //  - `pinnedUserId`: the sync engine boots in onMount (initSync), so without
  //    this it stays null through SSR/hydration and the sync icon paints its
  //    demo-mode "offline" look until then. Seeding it here matches the SSR and
  //    first client render; initSync re-sets the same value and drives sync.
  seedMe(data.me);
  syncStatus.pinnedUserId = currentUserId;

  onMount(() => {
    initSync(currentUserId);
    // Seed syncedAtSeq from SSR load so first push sends the right seq.
    if (data.state) seedSyncedAtSeq(data.state);
    const stored = loadPanels(currentUserId, appState.projects);
    if (stored) {
      if (compositionMatches(appState.panels, stored)) {
        // The panels were already server-rendered from the cookie and match
        // localStorage — just overlay the per-row UI state (selection/expansion),
        // which the cookie omits, without remounting any panel view.
        overlayRowState(appState.panels, stored);
      } else {
        // Cookie/localStorage drift (e.g. cookies cleared, or first load after
        // this feature shipped): rebuild from localStorage. May briefly remount
        // the SSR'd panels, but keeps every saved panel.
        const finalStored = ensureMainData(stored, appState.projects);
        applyStoredPanels(appState.panels, finalStored);
        restorePlacementProjects(appState.panels, finalStored);
      }
    }
    hydrated = true;
    // Reveal the panels (fallback for app.html's parse-end script) and mark the
    // page interactive — handlers are now attached, so the "making interactive"
    // banner hides, after its minimum show time has elapsed.
    markInteractive();
    const hijack = (_ev: WheelEvent) => {};
    document.addEventListener("wheel", hijack);
    return () => document.removeEventListener("wheel", hijack);
  });
</script>

{#if !hydrated}
  <!-- Phase 1 skeleton (removed at hydration): panel-shaped cards where the real
       panels will appear, so the HTML-download phase shows the layout taking
       shape instead of a blank page. Server-rendered for guests and signed-in
       users alike, sized from each panel's layout. CSS swaps it for the real
       panels at parse-end (see app.html). -->
  <div class="panel-placeholder">
    <div class="mx-auto flex">
      {#each appState.panels as p (p.id)}
        <div
          class="skeleton-card"
          style:margin-left="{typeof p.layout.spacerLeft === 'number' ? p.layout.spacerLeft : 0}px"
          style:width="{(p.layout.sideWidth === 'disabled' ? 0 : p.layout.sideWidth) +
            p.layout.mainWidth +
            2}px"
          style:height="{p.layout.height}px"
        ></div>
      {/each}
    </div>
  </div>
{/if}

<ContextMenuPopup>
  <ConfirmPopup>
    <SwitcherPopup>
      <PickerPopup>
        <ProjectListInsert>
          <TodoListInsert>
            <CheckListInsert>
              <!-- Panels render server-side for everyone now: guests from the
                   mock panels, signed-in users from the cookie composition the
                   server prefetched. Held hidden (panel-stage) until parse-end. -->
              <PanelGroup>
                {#snippet each(panel, index)}
                  <Panel {panel} isMainPanel={index === 0} />
                {/snippet}
              </PanelGroup>
            </CheckListInsert>
          </TodoListInsert>
        </ProjectListInsert>
      </PickerPopup>
    </SwitcherPopup>
  </ConfirmPopup>
</ContextMenuPopup>

<style>
  :global(.dragging-to-insert *) {
    cursor: default !important;
  }
</style>
