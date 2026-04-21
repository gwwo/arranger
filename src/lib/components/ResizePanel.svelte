<script lang="ts" module>
  import type { PanelLayout } from "$lib";
  const MIN_SIDE_WIDTH = 150;
  const MAX_SIDE_WIDTH = 600;
  const MIN_MAIN_WIDTH = 300;
  const MAX_MAIN_WIDTH = 600;
  const COLLAPSE_WIDTH = MIN_SIDE_WIDTH * (1 / 2);
  const MIN_HEIGHT = 300;
  const MAX_HEIGHT = 800;

  const MIN_MARGIN_LEFT = 10;
  const MAX_MARGIN_LEFT = 400;

  export const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

  const topBarHeight = 30;
  const bottomBarHeight = 40;

  const SIDE_TRANSITION_MS = 300;
</script>

<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import { capAsymptotic } from "$lib/components/drag-insert-list/utils";
  import { untrack, type Snippet } from "svelte";
  import { useDragControl } from "$lib/utils/drag-control.svelte";
  import { useNotifier } from "./PanelGroup.svelte";
  import type { ReadonlyDeep } from "$lib/utils/type-gymnastics";
  import { useUpdateLayout } from "$lib/client/mutate-local";

  type Props = {
    side?: Snippet<[topBarHeight: number, bottomBarHeight: number]>;
    main?: Snippet<[topBarHeight: number, bottomBarHeight: number]>;
    top?: Snippet<[resizingSide: boolean, sideReveal: number]>;
    layout: ReadonlyDeep<PanelLayout>;
  };

  let { side, main, top, layout: layoutSource }: Props = $props();

  const layout = $state(
    untrack(() => {
      const sideWidth = layoutSource.sideWidth === "disabled" ? 0 : layoutSource.sideWidth;
      return {
        sideWidthRaw: clamp(sideWidth, 0, MAX_SIDE_WIDTH),
        sideWidthContent: clamp(sideWidth, MIN_SIDE_WIDTH, MAX_SIDE_WIDTH),
        ...layoutSource,
      };
    }),
  );

  $effect(() => {
    const source = { ...layoutSource };
    untrack(() => Object.assign(layout, source));
  });

  const { notifyResizeStart, notifyResizeFinish } = useNotifier();

  const updateLayout = useUpdateLayout();

  let panelTranslateX: number | null = $state(null);
  let panelTranslateY: number | null = $state(null);

  let resizingSide = $state(false);
  let resizingMain = $state(false);
  let resizing = $derived(resizingSide || resizingMain);
  let adjustingSpacer = $state(false);

  let sideTransition: symbol | null = $state(null);

  let sideDerender = $derived(
    // use `!resizingSide`, not `!resizing`
    !resizingSide && sideTransition === null && layout.sideWidthRaw === 0,
  );

  let lastSideWidthRaw: number = layout.sideWidthRaw;
  $effect.pre(() => {
    const { sideWidthRaw } = layout;
    untrack(() => {
      if (resizing || sideWidthRaw > lastSideWidthRaw) {
        layout.sideWidthContent = clamp(sideWidthRaw, MIN_SIDE_WIDTH, MAX_SIDE_WIDTH);
      }
      if (resizing) return;
      if (lastSideWidthRaw === sideWidthRaw) return;
      // each sideTransition request is uniquely non-null
      sideTransition = Symbol();
    });
    lastSideWidthRaw = sideWidthRaw;
  });

  const endTransitionState = () => {
    sideTransition = null; // setting sideTransition will clear the timer.
    const { sideWidthRaw } = layout;
    layout.sideWidthContent = clamp(sideWidthRaw, MIN_SIDE_WIDTH, MAX_SIDE_WIDTH);
  };

  $effect.pre(() => {
    if (sideTransition == null) return;
    let timer = setTimeout(endTransitionState, SIDE_TRANSITION_MS + 50);
    return () => clearTimeout(timer);
  });

  $effect.pre(() => {
    const { sideShow, sideWidth } = layout;
    untrack(() => {
      layout.sideWidthRaw =
        sideWidth != "disabled" && sideShow ? clamp(sideWidth, MIN_SIDE_WIDTH, MAX_SIDE_WIDTH) : 0;
    });
  });

  const sideControl = useDragControl({
    cursorStyle: "col-resize",
    onClick: () => {
      const sideShow = !layout.sideShow;
      layout.sideShow = sideShow;
      updateLayout({ sideShow });
    },
    onStart: () => {
      notifyResizeStart();
      resizingSide = true;
      const { sideWidthRaw } = layout;
      return { sideWidthRaw };
    },
    onMove: (dx, dy, start) => {
      if (dx === 0) return;
      const freeWidth = start.sideWidthRaw + dx;
      const nextWidth = clamp(freeWidth, 0, MAX_SIDE_WIDTH);
      const overshoot = Math.abs(freeWidth - nextWidth);
      panelTranslateX =
        overshoot !== 0
          ? freeWidth > nextWidth
            ? capAsymptotic(overshoot)
            : -capAsymptotic(overshoot)
          : null;
      layout.sideWidthRaw = nextWidth;
    },
    onFinish: () => {
      resizingSide = false;
      panelTranslateX = null;
      const { sideWidthRaw, sideWidth } = layout;
      const endWidth =
        sideWidthRaw <= COLLAPSE_WIDTH ? 0 : clamp(sideWidthRaw, MIN_SIDE_WIDTH, MAX_SIDE_WIDTH);
      notifyResizeFinish({ dw: endWidth - sideWidthRaw });
      const sideShow = endWidth > 0;

      layout.sideWidthRaw = endWidth;
      layout.sideShow = sideShow;
      if (sideShow && sideWidth !== "disabled") layout.sideWidth = endWidth;
      updateLayout(sideShow ? { sideShow, sideWidth: endWidth } : { sideShow });
    },
  });

  function mainControl(
    direction: "nwse-resize" | "ew-resize" | "ns-resize",
  ): Attachment<HTMLDivElement> {
    const resizeWidth = (dx: number, start: { mainWidth: number; sideWidthRaw: number | null }) => {
      const freeMainWidth = start.mainWidth + dx;
      const nextMainWidth = clamp(freeMainWidth, MIN_MAIN_WIDTH, MAX_MAIN_WIDTH);
      const excess = Math.abs(freeMainWidth - nextMainWidth);
      const sideShrinkable = (start.sideWidthRaw ?? 0) - MIN_SIDE_WIDTH;
      const sideShrink =
        sideShrinkable > 0 && freeMainWidth < nextMainWidth ? Math.min(excess, sideShrinkable) : 0;
      const overshoot = excess - sideShrink;

      if (start.sideWidthRaw != null) {
        layout.sideWidthRaw = start.sideWidthRaw - sideShrink;
      }
      panelTranslateX =
        overshoot !== 0
          ? freeMainWidth > nextMainWidth
            ? capAsymptotic(overshoot)
            : -capAsymptotic(overshoot)
          : null;
      layout.mainWidth = nextMainWidth;
    };
    const resizeHeight = (dy: number, start: { height: number }) => {
      const freeHeight = start.height + dy;
      const nextHeight = clamp(freeHeight, MIN_HEIGHT, MAX_HEIGHT);
      const overshoot = Math.abs(freeHeight - nextHeight);
      panelTranslateY =
        overshoot !== 0
          ? freeHeight > nextHeight
            ? capAsymptotic(overshoot)
            : -capAsymptotic(overshoot)
          : null;
      layout.height = nextHeight;
    };

    const dir = direction;

    return useDragControl({
      cursorStyle: dir,
      onStart: () => {
        notifyResizeStart();
        resizingMain = true;
        const { height, mainWidth, sideWidth, sideWidthRaw } = layout;
        return { height, mainWidth, sideWidthRaw: sideWidth === "disabled" ? null : sideWidthRaw };
      },
      onMove: (dx, dy, start) => {
        if (dir === "ew-resize" || dir === "nwse-resize") {
          if (dx !== 0) resizeWidth(dx, start);
        }
        if (dir === "ns-resize" || dir === "nwse-resize") {
          if (dy !== 0) resizeHeight(dy, start);
        }
      },
      onFinish: () => {
        resizingMain = false;
        panelTranslateX = null;
        panelTranslateY = null;
        notifyResizeFinish();

        const updates: { mainWidth?: number; sideWidth?: number; height?: number } = {};
        if (dir === "ew-resize" || dir === "nwse-resize") {
          const { mainWidth, sideWidth, sideWidthRaw } = layout;
          if (sideWidthRaw > 0 && sideWidth !== "disabled") layout.sideWidth = sideWidthRaw;
          layout.mainWidth = mainWidth;

          updates.mainWidth = mainWidth;
          if (sideWidthRaw > 0) updates.sideWidth = sideWidthRaw;
        }
        if (dir === "ns-resize" || dir === "nwse-resize") {
          const { height } = layout;

          updates.height = height;
        }
        updateLayout(updates);
      },
    });
  }

  const spacerControl = useDragControl({
    cursorStyle: "ew-resize",
    onStart: () => {
      notifyResizeStart();
      adjustingSpacer = true;
      const { spacerLeft } = layout;
      return { spacerLeft };
    },
    onMove: (dx, dy, start) => {
      if (dx === 0) return;
      if (start.spacerLeft === "disabled") return;
      const free = start.spacerLeft + dx;
      const next = clamp(free, MIN_MARGIN_LEFT, MAX_MARGIN_LEFT);
      const overshoot = Math.abs(free - next);

      panelTranslateX =
        overshoot !== 0
          ? free > next
            ? capAsymptotic(overshoot)
            : -capAsymptotic(overshoot)
          : null;
      layout.spacerLeft = next;
    },
    onFinish: () => {
      adjustingSpacer = false;
      panelTranslateX = null;
      notifyResizeFinish();
      const { spacerLeft } = layout;
      if (spacerLeft !== "disabled") updateLayout({ spacerLeft });
    },
  });
</script>

<div
  class={[
    "relative size-fit",
    // will need this when margin-left changes due to reordering,
    // which is not a concern in  the current case
    !adjustingSpacer && "transition-[margin] duration-200 ease-linear",
  ]}
  style:margin-left="{layout.spacerLeft ?? 0}px"
>
  <div
    class={[
      "flex overflow-hidden rounded-2xl border border-teal-500 shadow-2xl",
      !resizing && "transition-transform duration-200 ease-linear",
      resizing && "select-none",
    ]}
    style:height="{layout.height}px"
    style:transform="translate({panelTranslateX ?? 0}px, {panelTranslateY ?? 0}px)"
  >
    {#if top != null}
      <div
        class="absolute inset-x-0 top-0 z-1 w-full overflow-hidden"
        style:height="{topBarHeight}px"
      >
        {@render top(
          resizingSide,
          layout.sideWidth == null ? 0 : clamp(layout.sideWidthRaw / MIN_SIDE_WIDTH, 0, 1),
        )}
      </div>
    {/if}
    <div
      class={["relative box-border h-full flex-none overflow-hidden"]}
      style:width="{layout.sideWidthRaw}px"
      style:transition={!resizing ? `width ${SIDE_TRANSITION_MS}ms ease` : ""}
      ontransitionend={(ev) => {
        if (ev.target !== ev.currentTarget) return;
        if (ev.propertyName !== "width") return;
        endTransitionState();
      }}
    >
      {#if !sideDerender}
        <div class="h-full" style:width="{layout.sideWidthContent}px">
          {@render side?.(topBarHeight, bottomBarHeight)}
        </div>
      {/if}
      <div class="absolute inset-y-0 right-0 z-10 w-px bg-gray-200"></div>
    </div>

    <div class="relative flex h-full flex-none" style:width="{layout.mainWidth}px">
      {@render main?.(topBarHeight, bottomBarHeight)}
      <!-- `overflow-hidden` here is important for avoiding Safari's quirks on transform with a overlay-->
      <!-- if you absolutely position this side pane slider at the left, in safari,
     it will cause a shift on the previously inserted row when inserting a new row abvove it from another list-->

      {#if layout.sideWidth !== "disabled"}
        <div
          class="group absolute inset-y-0 left-0 z-2 flex h-full w-4 items-center overflow-hidden"
        >
          <div
            class={[
              "group w-full cursor-col-resize transition-opacity",
              !resizingSide && "opacity-0 group-hover:opacity-100",
            ]}
            {@attach sideControl}
          >
            <div
              class="handle ml-1.5 h-16 w-1.5 rounded-full bg-gray-400 group-active:bg-gray-500"
            ></div>
          </div>
        </div>
      {/if}
    </div>
  </div>
  {#if layout.spacerLeft !== "disabled"}
    <div
      {@attach spacerControl}
      class="absolute inset-y-[14px] -left-[5px] w-[8px] cursor-ew-resize"
    ></div>
  {/if}
  <div
    {@attach mainControl("ns-resize")}
    class="absolute inset-x-[14px] -bottom-[5px] h-[10px] cursor-ns-resize"
  ></div>
  <div
    {@attach mainControl("ew-resize")}
    class="absolute inset-y-[14px] -right-[5px] w-[10px] cursor-ew-resize"
  ></div>
  <div
    {@attach mainControl("nwse-resize")}
    class="absolute -right-[2px] -bottom-[2px] size-[16px] cursor-nwse-resize"
  ></div>
</div>

<style>
  :global(.force-cursor *) {
    cursor: var(--cursor, auto) !important;
  }
</style>
