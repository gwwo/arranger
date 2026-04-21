<script lang="ts" module>
  import { createContext } from "svelte";

  type ResizeNotifier = {
    notifyResizeStart: () => void;
    notifyResizeFinish: (sizeEventual?: { dw?: number; dh?: number }, timeEnd?: number) => void;
  };

  const [useNotifier, setNotifier] = createContext<ResizeNotifier>();
  export { useNotifier };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { flip, splitFrom } from "$lib/utils/animate";
  import { getAppState } from "$lib/client/context";
  import type { PanelItem } from "$lib/client/model";

  type Props = {
    each: Snippet<[panel: PanelItem, index: number]>;
  };

  let { each }: Props = $props();
  let container: HTMLDivElement;
  let content: HTMLDivElement;

  let wContain: number | null = $state(null);
  let hContain: number | null = $state(null);

  setNotifier({
    notifyResizeStart: () => {
      const { width, height } = content.getBoundingClientRect();
      wContain = width;
      hContain = height;
    },
    notifyResizeFinish: (
      sizeEventual: { dw?: number; dh?: number } = {},
      timeEnd: number = 500,
    ) => {
      const { dw = 0, dh = 0 } = sizeEventual;
      const { width: w, height: h } = content.getBoundingClientRect();
      // const enter = container.getBoundingClientRect();
      const width = w + dw;
      const height = h + dh;
      // container.style.width = `${width}px`;
      // container.style.height = `${height}px`;

      // const stable = container.getBoundingClientRect();
      // const flipX = enter.left - stable.left;
      // const flipY = enter.top - stable.top;

      // container.animate(
      //   [{ transform: `translate(${flipX}px, ${flipY}px)` }, { transform: "translate(0, 0)" }],
      //   { duration: 400, easing: "ease-out" },
      // );

      // necessary to animate content?
      const anim = container.animate(
        [
          { width: `${wContain}px`, height: `${hContain}px` },
          { width: `${width}px`, height: `${height}px` },
        ],
        { duration: 400, easing: "ease-out", fill: "forwards" },
      );

      setTimeout(() => {
        wContain = null;
        hContain = null;
        anim.cancel();
      }, timeEnd + 10);
    },
  });

  const appState = getAppState()
  let panels = $derived(appState.panels);
</script>

<!-- using `z-1` so that insert pile is stacked on top -->
<div
  class="relative z-1 flex min-h-screen w-full items-center overflow-x-auto overflow-y-visible p-4"
>
  <div
    bind:this={container}
    class="mx-auto flex-none"
    style:height={hContain != null ? `${hContain}px` : "fit-content"}
    style:width={wContain != null ? `${wContain}px` : "fit-content"}
  >
    <div bind:this={content} class="flex size-fit">
      {#each panels as panel, index (panel.id)}
        <div
          style:z-index={`${99 - index}`}
          animate:flip={{ duration: 600 }}
          in:splitFrom={{ duration: 500 }}
        >
          {@render each(panel, index)}
        </div>
      {/each}
    </div>
  </div>
</div>
