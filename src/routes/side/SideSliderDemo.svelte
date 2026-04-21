<script lang="ts" module>
  import type { Attachment } from "svelte/attachments";

  type PointerControlOptions<TStart> = {
    onStart: () => TStart;
    onMove: (dx: number, dy: number, start: TStart) => void;
    onFinish: () => void;
    onClick?: () => void;
  };

  const useDragControl = <TStart,>(
    arg: PointerControlOptions<TStart>,
  ): Attachment<HTMLDivElement> => {
    const { onStart, onMove, onFinish, onClick } = arg;
    return (node) => {
      let start: { x: number; y: number } | null = $state.raw(null);

      $effect(() => {
        if (start == null) return;
        const { x, y } = start;
        let startInfo: TStart | null = null;

        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - x;
          const dy = ev.clientY - y;
          if (startInfo == null) {
            if (Math.sqrt(dx ** 2 + dy ** 2) > 4) startInfo = onStart();
          }
          if (startInfo != null) {
            onMove(Math.round(dx), Math.round(dy), startInfo);
          }
        };

        const finish = (ev: PointerEvent) => {
          start = null;
          startInfo == null ? onClick?.() : onFinish();
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
        return () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
        };
      });

      const begin = (ev: PointerEvent) => {
        ev.preventDefault();
        start = { x: ev.clientX, y: ev.clientY };
      };

      node.addEventListener("pointerdown", begin);
      return () => node.removeEventListener("pointerdown", begin);
    };
  };

  const MIN_SIDE_WIDTH = 150;
  const MAX_SIDE_WIDTH = 600;
  const COLLAPSE_WIDTH = MIN_SIDE_WIDTH * (1 / 2);
  const TRANSITION_MS = 500;

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  export type Layout = {
    sideShow: boolean;
    sideWidth: number | null;
  };
</script>

<script lang="ts">
  import { untrack } from "svelte";

  type Props = {
    layout?: Layout;
  };

  let { layout: layoutSource = $bindable({ sideShow: true, sideWidth: 50 }) }: Props = $props();

  const layout = $state({
    sideWidthRaw: clamp(layoutSource.sideWidth ?? 0, 0, MAX_SIDE_WIDTH),
    sideWidthContent: clamp(layoutSource.sideWidth ?? 0, MIN_SIDE_WIDTH, MAX_SIDE_WIDTH),
    ...layoutSource,
  });

  $effect(() => {
    const source = { ...layoutSource };
    untrack(() => Object.assign(layout, source));
  });

  let resizingSide = $state(false);
  let sideTransition: symbol | null = $state(null);

  let sideDerender = $derived(
    !resizingSide && sideTransition === null && layout.sideWidthRaw === 0,
  );

  let lastSideWidthRaw = layout.sideWidthRaw;
  $effect.pre(() => {
    const { sideWidthRaw } = layout;
    untrack(() => {
      if (resizingSide || sideWidthRaw > lastSideWidthRaw) {
        layout.sideWidthContent = clamp(sideWidthRaw, MIN_SIDE_WIDTH, MAX_SIDE_WIDTH);
      }
    });
    untrack(() => {
      if (resizingSide) return;
      if (lastSideWidthRaw === sideWidthRaw) return;
      // each sideTransition request is uniquely non-null
      sideTransition = Symbol();
    });
    lastSideWidthRaw = sideWidthRaw;
  });

  const endTransitionState = () => {
    const { sideWidthRaw } = layout;
    layout.sideWidthContent = clamp(sideWidthRaw, MIN_SIDE_WIDTH, MAX_SIDE_WIDTH);
    sideTransition = null; // setting sideTransition will clear the timer.
  };

  $effect.pre(() => {
    if (sideTransition == null) return;
    let timer = setTimeout(endTransitionState, TRANSITION_MS + 50);
    return () => clearTimeout(timer);
  });

  $effect.pre(() => {
    const { sideShow, sideWidth } = layout;
    untrack(() => {
      layout.sideWidthRaw =
        sideWidth != null && sideShow ? clamp(sideWidth, MIN_SIDE_WIDTH, MAX_SIDE_WIDTH) : 0;
    });
  });

  const sideControl = useDragControl({
    onClick: () => {
      const sideShow = !layout.sideShow;
      layout.sideShow = sideShow;
      setTimeout(() => {
        layoutSource.sideShow = sideShow;
      }, 2000);
    },
    onStart: () => {
      resizingSide = true;
      const { sideWidthRaw } = layout;
      return { sideWidthRaw };
    },
    onMove: (dx, dy, start) => {
      if (dx === 0) return;
      const freeWidth = start.sideWidthRaw + dx;
      const nextWidth = clamp(freeWidth, 0, MAX_SIDE_WIDTH);
      layout.sideWidthRaw = nextWidth;
    },
    onFinish: () => {
      resizingSide = false;
      const { sideWidthRaw } = layout;
      const endWidth =
        sideWidthRaw <= COLLAPSE_WIDTH ? 0 : clamp(sideWidthRaw, MIN_SIDE_WIDTH, MAX_SIDE_WIDTH);
      const sideShow = endWidth > 0;

      layout.sideWidthRaw = endWidth;
      layout.sideShow = sideShow;

      const updateSideWidth = sideShow;
      if (updateSideWidth) layout.sideWidth = endWidth;

      setTimeout(() => {
        layoutSource.sideShow = sideShow;
        if (updateSideWidth) layoutSource.sideWidth = endWidth;
      }, 2000);
    },
  });
</script>

<div class="fixed top-0 left-0">
  <p>
    sideShow: {layout.sideShow}; resizingSide: {resizingSide}; sideWidth: {layout.sideWidth ??
      "null"}; sideWidthContent: {layout.sideWidthContent ?? "null"}; sideTransition: {sideTransition !=
      null}; sideWidthRaw: {layout.sideWidthRaw} sideDerender: {sideDerender}
  </p>
  <p>
    source.sideShow: {layoutSource.sideShow}; source.sideWidth = {layoutSource.sideWidth}
  </p>
</div>

<button
  class="mt-20"
  onclick={() => {
    layoutSource.sideWidth = 400;
  }}
  >set width
</button>

<button
  class="mt-20"
  onclick={() => {
    layoutSource.sideWidth = 300;
    layoutSource.sideShow = true;
  }}
  >set width 2
</button>

<button
  class="mt-20"
  onclick={() => {
    layoutSource.sideShow = false;
  }}
  >set width close
</button>

<div class="relative w-fit">
  <div
    class="mt-40 ml-40 box-border h-80 overflow-hidden border-r-10 border-gray-200 bg-red-500 py-2"
    style:width="{layout.sideWidthRaw}px"
    style:transition={!resizingSide ? `width ${TRANSITION_MS}ms linear` : ""}
    ontransitionend={(ev) => {
      if (ev.target !== ev.currentTarget) return;
      if (ev.propertyName !== "width") return;
      endTransitionState();
    }}
  >
    {#if !sideDerender}
      <div class="h-full bg-amber-400" style:width="{layout.sideWidthContent}px">
        !resizingSide && "transition-transform duration-200 ease-linear", !resizingSide &&
        "transition-transform duration-200 ease-linear",
      </div>
    {/if}
  </div>
  {#if layout.sideWidth != null}
    <div
      class="absolute inset-y-4 -right-1 w-2 cursor-col-resize bg-purple-500"
      {@attach sideControl}
    ></div>
  {/if}
</div>
