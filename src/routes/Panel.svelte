<script lang="ts">
  import {
    isProjectInstance,
    isPlacementInstance,
    type Instance,
    type PanelItem,
  } from "$lib";
  import NavBar from "$lib/components/NavBar.svelte";
  import OperationPage from "$lib/components/operation-list/OperationPage.svelte";
  import PanelMain from "$lib/components/PanelMain.svelte";
  import PanelSide from "$lib/components/PanelSide.svelte";
  import ResizePanel from "$lib/components/ResizePanel.svelte";
  import { setPanelContext, getAppState } from "$lib/client/context";
  import { usePanelFocus } from "$lib/components/PanelGroup.svelte";
  import { untrack } from "svelte";

  type Props = {
    panel: PanelItem;
    isMainPanel: boolean;
  };

  let { panel, isMainPanel }: Props = $props();

  let newProjIdToReveal: string | null = $state(null);

  setPanelContext({ panelId: panel.id });
  const appState = getAppState();

  const panelFocus = usePanelFocus();
  let panelFocused = $derived(panelFocus.multiPanel && panelFocus.panelId === panel.id);

  // The navbar + sidebar follow the selection immediately; the main content
  // (`displayed`) lags so a navigation keeps the previous page on screen until
  // the new scope's data is ready — no blank flash on a fast load. Only if the
  // load runs past the grace window do we commit and reveal the spinner.
  let instance = $derived(panel.instance);

  const GRACE_MS = 150; // keep previous page / withhold spinner this long
  const SPINNER_MIN_MS = 300; // once shown, hold the spinner at least this long

  const scopeReady = (inst: Instance): boolean => {
    if (isProjectInstance(inst)) return !appState.projStub[inst.project.id];
    if (isPlacementInstance(inst)) return !appState.placementStub[inst.kind];
    return true; // simple operations have no async data
  };

  let displayed = $state<Instance>(untrack(() => panel.instance));
  let showSpinner = $state(false);
  let spinnerShownAt = 0;

  $effect(() => {
    const target = panel.instance;
    if (scopeReady(target)) {
      // Ready → show it. If a spinner is up, hold it out its minimum first.
      displayed = target;
      if (!showSpinner) return;
      const remaining = SPINNER_MIN_MS - (performance.now() - spinnerShownAt);
      if (remaining <= 0) {
        showSpinner = false;
        return;
      }
      const h = setTimeout(() => (showSpinner = false), remaining);
      return () => clearTimeout(h);
    }
    // Target not ready: keep the current page during the grace window, then
    // commit to it and reveal the spinner.
    if (displayed === target && showSpinner) return;
    const h = setTimeout(() => {
      displayed = target;
      spinnerShownAt = performance.now();
      showSpinner = true;
    }, GRACE_MS);
    return () => clearTimeout(h);
  });

  // ─── Fetch progress bar ──────────────────────────────────────────────────
  // The focus-indication line (top of the bottom bar) doubles as a progress bar
  // while the panel's target scope is fetching. It starts the moment a switch is
  // triggered — so even a fast load gives feedback — trickles toward ~90% while
  // loading, then completes to 100% and fades the instant the data is ready.
  let fetching = $derived(!scopeReady(panel.instance));

  let progress = $state(0); // 0..100, the bar's width
  let progressVisible = $state(false);
  let progressMs = $state(0); // width transition duration

  $effect(() => {
    if (fetching) {
      // Start: snap to 0, then trickle toward 90% with a long ease-out.
      progressVisible = true;
      progress = 0;
      progressMs = 0;
      const r = requestAnimationFrame(() => {
        progressMs = 8000;
        progress = 90;
      });
      return () => cancelAnimationFrame(r);
    }
    // Done: complete to 100%, then fade out.
    if (!progressVisible) return;
    progressMs = 220;
    progress = 100;
    const t = setTimeout(() => (progressVisible = false), 260);
    return () => clearTimeout(t);
  });
</script>

<ResizePanel layout={panel.layout} {panelFocused}>
  {#snippet side(topBarHeight, bottomBarHeight)}
    <PanelSide bind:newProjIdToReveal {instance} {topBarHeight} {bottomBarHeight} />
  {/snippet}
  {#snippet main(topBarHeight, bottomBarHeight, sideReveal, resizingSide)}
    {#key displayed}
      {#if isProjectInstance(displayed)}
        <PanelMain bind:newProjIdToReveal instance={displayed} {showSpinner} {topBarHeight} {bottomBarHeight} />
      {:else}
        <OperationPage instance={displayed} {showSpinner} {topBarHeight} {bottomBarHeight} {sideReveal} {resizingSide}></OperationPage>
      {/if}
    {/key}
    {#if progressVisible}
      <!-- Replaces the focus-indication line (top of the bottom bar, where the
           static border is suppressed via `progressing`) while this panel's
           target scope fetches. On reaching 100% it's removed in the same tick
           the static focus border returns, so it hands off seamlessly. -->
      <div
        class="pointer-events-none absolute inset-x-0 z-30 h-0.5 overflow-hidden bg-teal-100"
        style:bottom="{bottomBarHeight - 2}px"
      >
        <div
          class="h-full bg-teal-500"
          style:width="{progress}%"
          style:transition="width {progressMs}ms ease-out"
        ></div>
      </div>
    {/if}
  {/snippet}
  {#snippet top(resizingSide, sideReveal)}
    <NavBar
      {isMainPanel}
      {instance}
      swicherOpacity={0.01 * Math.round(100 * (1 - sideReveal))}
      opacityTransition={!resizingSide}
      disable={panel.layout.sideShow}
    ></NavBar>
  {/snippet}
</ResizePanel>
