<script lang="ts" module>
  export const MAX_PANEL_COUNT = 3;
</script>

<script lang="ts">
  import {
    useSwitcher,
    type ProjectItem,
    type PanelItem,
    newPanelItem,
    newProjectInstance,
    placeholder,
    isProjectInstance,
    operationOf,
    type ProjectInstance,
    type Instance,
  } from "$lib";
  import type { OperationInstance } from "$lib/client/model";
  import {
    useClonePanel,
    useClosePanel,
    useSetOperationInPanel,
    useSetProjInPanel,
  } from "$lib/client/mutate-local";
  import { syncStatus, overlay, scopeOverlay, placementMoves } from "$lib/client/sync.svelte";
  import { getAppState, getSyncHooks, getPanelContext } from "$lib/client/context";
  import { usePanelFocus } from "$lib/components/PanelGroup.svelte";
  import { isPinnedUserBlocked } from "$lib/components/user-panel/UserPanel.svelte";

  type Props = {
    isMainPanel: boolean;
    instance: Instance;
    swicherOpacity: number;
    opacityTransition: boolean;
    disable?: boolean;
  };

  let {
    isMainPanel,
    instance,
    swicherOpacity,
    disable = false,
    opacityTransition,
  }: Props = $props();

  const switcher = useSwitcher();
  const appState = getAppState();
  const { panelId } = getPanelContext();
  const panelFocus = usePanelFocus();

  // A project opened from a placement view (archive/trash) should present as
  // that view, not as its own project, in the navbar/switcher.
  let openFrom = $derived(
    isProjectInstance(instance) ? appState.openProjPlacement.get(instance.project.id) : undefined,
  );

  const setProjInPanel = useSetProjInPanel();
  const setOperationInPanel = useSetOperationInPanel();
  const closePanel = useClosePanel();
  const clonePanel = useClonePanel();

  const labelFromOperation = (value: OperationInstance) =>
    value.charAt(0).toUpperCase() + value.slice(1);

  const syncHooks = getSyncHooks();
  // "syncing" covers both an in-flight push and queued ops waiting for one
  // to start — visually they're the same "work pending" state to the user.
  // "offline" = no pinned user (demo mode); sync is suppressed end-to-end.
  let syncState: "offline" | "syncing" | "synced" | "failed" = $derived(
    syncStatus.pinnedUserId == null
      ? "offline"
      : syncStatus.error != null || isPinnedUserBlocked()
        ? "failed"
        : syncStatus.inflight || overlay.size > 0 || scopeOverlay.size > 0 || placementMoves.length > 0
          ? "syncing"
          : "synced",
  );

  // Drive the spin via Web Animations API rather than a toggled CSS class,
  // so a sync that finishes mid-rotation can let the current rotation play
  // out instead of snapping back to 0°. Each `animate()` is one full
  // rotation; `onfinish` decides whether to chain another.
  //
  // Clicks are guaranteed one full rotation of feedback regardless of how
  // fast (or instantly-failed) the sync resolves — pendingClickRotation is
  // set on click, consumed when the NEXT rotation starts, and the icon
  // swap to the alert state is gated on the animation having stopped.
  let iconEl: HTMLElement | null = $state.raw(null);
  let activeAnim = $state.raw<Animation | null>(null);
  let pendingClickRotation = $state(false);

  function spinOnce(el: HTMLElement) {
    const anim = el.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: 1000, easing: "linear" },
    );
    activeAnim = anim;
    // Claim the click pledge: this rotation is the one that satisfies it.
    pendingClickRotation = false;
    anim.onfinish = () => {
      if (activeAnim !== anim) return; // superseded
      activeAnim = null;
      if (syncState === "syncing" || pendingClickRotation) {
        spinOnce(el);
      }
    };
  }

  $effect(() => {
    const el = iconEl;
    if (!el || activeAnim) return;
    if (syncState === "offline") return;
    if (syncState === "syncing" || pendingClickRotation) spinOnce(el);
  });

  // Each click extends the visual feedback (pendingClickRotation), but only
  // one refresh() may be in flight at a time — concurrent push+pull cycles
  // would race to overwrite appState and double the server traffic.
  let refreshInFlight = false;
  async function handleClick() {
    pendingClickRotation = true;
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      await syncHooks?.refresh();
    } finally {
      refreshInFlight = false;
    }
  }

  const popup = (ev: MouseEvent & { currentTarget: EventTarget & HTMLElement }) => {
    if (disable) return;
    switcher.popup({
      anchor: ev.currentTarget,
      getCurrent: () =>
        openFrom
          ? { kind: "operation", value: openFrom }
          : isProjectInstance(instance)
            ? { kind: "project", id: instance.project.id }
            : { kind: "operation", value: operationOf(instance)! },
      // Navigating the panel via the switcher moves keyboard-shortcut focus to
      // this panel's page — unlike merely opening the popup, which leaves focus
      // where it was.
      showProject: (projId) => {
        setProjInPanel(projId);
        panelFocus.setFocus(panelId, "main");
      },
      showOperation: (op) => {
        setOperationInPanel(op);
        panelFocus.setFocus(panelId, "main");
      },
    });
  };
</script>

<div class="flex h-full items-center gap-2 px-4 pt-1 text-gray-400">
  <div class="size-5 flex-none">
    {#if isMainPanel}
      {@const showAlert =
        syncState === "failed" && !activeAnim && !pendingClickRotation}
      {@const offline = syncState === "offline"}
      <button
        onclick={handleClick}
        disabled={offline}
        class={[
          "group flex size-full items-center justify-center rounded-md active:bg-teal-400/20",
          !offline && "hover:border hover:border-gray-400",
          showAlert && "text-red-500",
          offline && "cursor-not-allowed text-gray-400",
        ]}
        aria-label={offline
          ? "sync disabled — sign in to sync"
          : syncState === "syncing"
            ? "syncing"
            : syncState === "failed"
              ? `sync failed — click to retry${syncStatus.error ? ` (${syncStatus.error})` : ""}`
              : "synced — click to sync now"}
        title={offline
          ? "Sign in to sync"
          : syncState === "failed" && syncStatus.error
            ? syncStatus.error
            : undefined}
      >
        {#if offline}
          <span class="icon-[mdi--sync-off] size-4.5"></span>
        {:else if showAlert}
          <span class="icon-[mdi--alert-circle-outline] size-4.5"></span>
        {:else}
          <span bind:this={iconEl} class="icon-[mdi--sync] size-4.5"></span>
        {/if}
      </button>
    {:else}
      <button
        onclick={closePanel}
        class="group flex size-full items-center justify-center rounded-md hover:border hover:border-gray-400 active:bg-teal-400/20"
        aria-label="to close panel"
      >
        <!-- <span class="icon-[material-symbols--tab-close-outline]"></span> -->
        <span class="icon-[iconamoon--close] size-4"></span>
      </button>
    {/if}
  </div>

  <div class="flex flex-1 justify-center overflow-hidden">
    <button
      style:opacity={swicherOpacity}
      class={[
        "flex cursor-default items-center gap-1 overflow-hidden rounded-sm pl-1 select-none",
        "border border-transparent hover:border-gray-300 active:bg-gray-200",
        opacityTransition && "transition-opacity duration-250 ease-linear",
      ]}
      onclick={popup}
    >
      <span class="truncate leading-6">
        {openFrom
          ? labelFromOperation(openFrom)
          : isProjectInstance(instance)
            ? instance.project.name || placeholder.project.name
            : labelFromOperation(operationOf(instance)!)}
      </span>
      <span class="icon-[mi--select] shrink-0"></span>
    </button>
  </div>
  <div class="size-5 flex-none">
    {#if isMainPanel}
      <button
        onclick={(e) => {
          clonePanel();
          // Don't keep DOM focus on the button: this app drives keyboard
          // shortcuts via panelFocus, and a focused button would show a
          // :focus-visible ring on the next keypress (e.g. arrow panel-switch).
          e.currentTarget.blur();
        }}
        class="group flex size-full items-center justify-center"
        aria-label="to duplicate list"
      >
        <span
          class="icon-[mingcute--copy-2-line] group-hover:icon-[icon-park-solid--copy] size-4 group-active:bg-teal-400"
        ></span>
      </button>
    {/if}
  </div>
</div>
