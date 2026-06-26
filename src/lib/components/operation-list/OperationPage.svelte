<script lang="ts">
  import type { PlacementInstance, SimpleOperation } from "$lib/client/model";
  import { operations } from "./OperationList.svelte";
  import UserPanel from "../user-panel/UserPanel.svelte";
  import InboxView from "./InboxView.svelte";
  import ArchiveView from "./ArchiveView.svelte";
  import TrashView from "./TrashView.svelte";
  import PlacementTitle from "./PlacementTitle.svelte";
  import { getAuthHooks, getPanelContext, getAppState } from "$lib/client/context";
  import { usePanelFocus } from "$lib/components/PanelGroup.svelte";

  type Props = {
    instance: PlacementInstance | SimpleOperation;
    topBarHeight?: number;
    bottomBarHeight?: number;
    sideReveal?: number;
    resizingSide?: boolean;
    // Show the loading spinner. Owned by Panel (delay/min timing); the previous
    // page stays up during a fast load and the spinner shows only for a slow one.
    showSpinner?: boolean;
  };
  let {
    instance,
    topBarHeight = 0,
    bottomBarHeight = 0,
    sideReveal = 0,
    resizingSide = false,
    showSpinner = false,
  }: Props = $props();

  // The view-selector string (placement kind or simple-operation name).
  let value = $derived(typeof instance === "string" ? instance : instance.kind);
  let placement = $derived(typeof instance === "string" ? null : instance);

  let iconClass = $derived(
    operations.find((operation) => operation.value === value)?.iconClass ?? "",
  );

  const auth = getAuthHooks();
  const appState = getAppState();

  // Placement entries are lazy-loaded; hold a placeholder until they arrive so
  // the list mounts with its data already present (no per-row intro animation).
  let placementLoading = $derived(placement != null && appState.placementStub[placement.kind]);
  let placementTitle = $derived(
    placement?.kind === "inbox" ? "Inbox" : placement?.kind === "archive" ? "Archive" : "Trash",
  );

  // Darken the panel while a placement row is expanded, mirroring PanelMain.
  let darkenBackground = $derived(placement?.expandedId != null);

  const { panelId } = getPanelContext();
  const panelFocus = usePanelFocus();
  let sectionFocused = $derived(panelFocus.panelId === panelId);

  // Inbox bottom-bar wiring: the InboxView owns the create/schedule logic; this
  // page just renders the buttons and delegates via bind:this.
  let inboxViewEl = $state<InboxView | null>(null);
  let inboxSelectedCount = $derived(
    placement?.kind === "inbox"
      ? appState.inbox.filter((t) => placement.selected.has(t.id)).length
      : 0,
  );

  // Archive bottom-bar wiring: ArchiveView owns the schedule logic. Only todo
  // entries can be scheduled, so the button's enabled state counts those.
  let archiveViewEl = $state<ArchiveView | null>(null);
  let archiveSelectedTodoCount = $derived(
    placement?.kind === "archive"
      ? appState.archive.filter((e) => e.kind === "todo" && placement.selected.has(e.id)).length
      : 0,
  );

  // Trash bottom-bar wiring: schedule (todos only) + empty/permanently-delete.
  let trashViewEl = $state<TrashView | null>(null);
  let trashSelectedTodoCount = $derived(
    placement?.kind === "trash"
      ? appState.trash.filter((e) => e.kind === "todo" && placement.selected.has(e.id)).length
      : 0,
  );
  let trashEntryCount = $derived(placement?.kind === "trash" ? appState.trash.length : 0);
  let trashSelectedCount = $derived(
    placement?.kind === "trash"
      ? appState.trash.filter((e) => placement.selected.has(e.id)).length
      : 0,
  );
</script>

{#if value === "account"}
  <UserPanel onAuthChange={auth?.onAuthChange} {topBarHeight} />
{:else if placement}
  <div
    class={[
      "flex size-full flex-col transition-[background-color]",
      darkenBackground ? "bg-[#f5f5f7]" : "bg-[#f9fafb]",
    ]}
    style:padding-top="{topBarHeight}px"
    onpointerdown={() => panelFocus.setFocus(panelId, "main")}
  >
    <div class="flex min-h-0 flex-1 flex-col">
      {#if placementLoading || showSpinner}
        <!-- Keep the title; show the spinner only when Panel says so (slow load).
             During the grace window the area stays blank — but Panel is usually
             still showing the previous page, so this isn't seen. -->
        <PlacementTitle title={placementTitle} {topBarHeight} {sideReveal} {resizingSide} />
        <div class="flex min-h-0 flex-1 items-center justify-center">
          {#if showSpinner}<p class="text-sm text-neutral-500">Loading…</p>{/if}
        </div>
      {:else if placement.kind === "inbox"}
        <InboxView bind:this={inboxViewEl} instance={placement} {topBarHeight} {sideReveal} {resizingSide} />
      {:else if placement.kind === "archive"}
        <ArchiveView bind:this={archiveViewEl} instance={placement} {topBarHeight} {sideReveal} {resizingSide} />
      {:else if placement.kind === "trash"}
        <TrashView bind:this={trashViewEl} instance={placement} {topBarHeight} {sideReveal} {resizingSide} />
      {/if}
    </div>
    {#if !placementLoading || showSpinner}
      <!-- Hidden only during the fast grace/blank window; shown (with the focus
           line / progress bar on top) once the spinner is up or entries are ready. -->
      <div
        class={[
          "flex w-full flex-none items-center justify-center gap-2 text-gray-500 transition-colors duration-200",
          sectionFocused ? "border-t-2 border-t-teal-500" : "border-t border-gray-200",
          showSpinner && "pointer-events-none opacity-40",
        ]}
        style:height="{bottomBarHeight}px"
      >
        {#if placement.kind === "inbox"}
          <button
            class="flex h-7 w-16 items-center justify-center rounded-full border border-transparent hover:border-gray-300 active:bg-gray-300/20"
            aria-label="create a new todo"
            onclick={() => inboxViewEl?.createTodo()}
          >
            <span class="icon-[material-symbols--add-rounded] size-5"></span>
          </button>
          <button
            class="flex h-7 w-16 items-center justify-center rounded-full border border-transparent enabled:hover:border-gray-300 enabled:active:bg-gray-300/20 disabled:opacity-40"
            aria-label="assign a date"
            disabled={inboxSelectedCount === 0}
            onclick={(ev) => inboxViewEl?.scheduleDate(ev.currentTarget)}
          >
            <span class="icon-[stash--calendar-solid] size-5 opacity-80"></span>
          </button>
        {:else if placement.kind === "archive"}
          <button
            class="flex h-7 w-16 items-center justify-center rounded-full border border-transparent enabled:hover:border-gray-300 enabled:active:bg-gray-300/20 disabled:opacity-40"
            aria-label="assign a date"
            disabled={archiveSelectedTodoCount === 0}
            onclick={(ev) => archiveViewEl?.scheduleDate(ev.currentTarget)}
          >
            <span class="icon-[stash--calendar-solid] size-5 opacity-80"></span>
          </button>
        {:else if placement.kind === "trash"}
          <button
            class="flex h-7 w-16 items-center justify-center rounded-full border border-transparent enabled:hover:border-gray-300 enabled:active:bg-gray-300/20 disabled:opacity-40"
            aria-label="assign a date"
            disabled={trashSelectedTodoCount === 0}
            onclick={(ev) => trashViewEl?.scheduleDate(ev.currentTarget)}
          >
            <span class="icon-[stash--calendar-solid] size-5 opacity-80"></span>
          </button>
          <button
            class="flex h-7 w-16 items-center justify-center rounded-full border border-transparent enabled:hover:border-gray-300 enabled:active:bg-gray-300/20 disabled:opacity-40"
            aria-label={trashSelectedCount > 0 ? "permanently delete selected" : "empty trash"}
            disabled={trashEntryCount === 0}
            onclick={(ev) => trashViewEl?.confirmPurge(ev.currentTarget)}
          >
            <span class="icon-[material-symbols--delete-forever-outline] size-5 opacity-80"></span>
          </button>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <div class="flex size-full items-center justify-center gap-3 bg-[#f9fafb]">
    {#if iconClass}
      <span class={[iconClass, "size-6"]}></span>
    {/if}
    <span class="font-semibold text-gray-700">Under Construction</span>
  </div>
{/if}
