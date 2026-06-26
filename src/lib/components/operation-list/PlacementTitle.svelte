<script lang="ts">
  // Shared title header for the placement views (inbox / archive / trash).
  // It extends up behind the navbar so the title reaches the top of the panel,
  // and fades/collapses in lockstep with the side bar reveal (mirroring the
  // navbar switcher).
  type Props = {
    title: string;
    topBarHeight?: number;
    // 0..1 reveal of this panel's side bar; tracks the live drag.
    sideReveal?: number;
    // True while the side bar is drag-resized: suppress the transition so the
    // title tracks the cursor instead of easing after release.
    resizingSide?: boolean;
  };
  let { title, topBarHeight = 0, sideReveal = 0, resizingSide = false }: Props = $props();

  // Natural height of the title text, measured so the header can collapse
  // proportionally with sideReveal.
  let titleHeight = $state(0);
  // Gap from the very top of the panel down to the title text. Smaller than
  // topBarHeight so the title sits near the top and spills past the bottom of
  // the navbar region.
  const titleTopGap = 20;
  // The wrapper is pulled up by topBarHeight (negative margin) and its own
  // height equals the list's top baseline: topBarHeight when hidden (list sits
  // just below the navbar) easing up to the full title extent when shown.
  let titleWrapperHeight = $derived(
    topBarHeight + sideReveal * (titleTopGap + titleHeight - topBarHeight),
  );

  // Suppress the transition until the first user-driven side-bar change, so the
  // title doesn't ease in on mount / reload (it snaps to its restored state);
  // the transition arms only once sideReveal actually changes.
  let animate = $state(false);
  let armed = false;
  $effect.pre(() => {
    void sideReveal;
    if (!armed) {
      armed = true;
      return;
    }
    animate = true;
  });
</script>

<div
  class={[
    "overflow-hidden",
    animate && !resizingSide && "transition-[height,opacity] duration-300 ease-linear",
  ]}
  style:margin-top="-{topBarHeight}px"
  style:height="{titleWrapperHeight}px"
  style:opacity={sideReveal}
>
  <div style:height="{titleTopGap}px"></div>
  <div bind:offsetHeight={titleHeight} class="border-b border-gray-200 px-5 pb-1">
    <h2 class="text-lg font-semibold text-gray-700">{title}</h2>
  </div>
</div>
