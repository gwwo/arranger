<script lang="ts" module>
  import { createContext } from "svelte";

  type ResizeNotifier = {
    notifyResizeStart: () => void;
    notifyResizeFinish: (sizeEventual?: { dw?: number; dh?: number }, timeEnd?: number) => void;
  };

  const [useNotifier, setNotifier] = createContext<ResizeNotifier>();
  export { useNotifier };

  export type PanelFocusSection = "side" | "main";

  type PanelFocusCtx = {
    readonly panelId: string | null;
    readonly section: PanelFocusSection;
    readonly multiPanel: boolean;
    setFocus(panelId: string, section: PanelFocusSection): void;
  };

  const [usePanelFocus, setPanelFocusCtx] = createContext<PanelFocusCtx>();
  export { usePanelFocus };
</script>

<script lang="ts">
  import { untrack, type Snippet } from "svelte";
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

  let focusPanelId = $state<string | null>(null);
  let focusSection = $state<PanelFocusSection>("main");

  $effect(() => {
    const ids = new Set(panels.map((p) => p.id));
    untrack(() => {
      if (focusPanelId != null && !ids.has(focusPanelId)) {
        focusPanelId = panels.length > 0 ? panels[0].id : null;
      } else if (focusPanelId == null && panels.length > 0) {
        focusPanelId = panels[0].id;
      }
    });
  });

  setPanelFocusCtx({
    get panelId() { return focusPanelId; },
    get section() { return focusSection; },
    get multiPanel() { return panels.length >= 2; },
    setFocus(panelId, section) {
      focusPanelId = panelId;
      focusSection = section;
    },
  });

  // Left/Right switches the focused panel (wrapping around). Handled centrally
  // here — it's a panel-level concern that owns `panels`/`focusPanelId` — rather
  // than in each per-view keydown handler (which own only their Up/Down row
  // navigation). The effect body reads no reactive state, so the listener is
  // installed once; the handler reads the current panels/focus at event time.
  $effect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Don't hijack caret movement while editing text.
      const el = e.target as HTMLElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el.isContentEditable
      ) return;
      if (panels.length < 2) return;
      e.preventDefault();
      const current = panels.findIndex((p) => p.id === focusPanelId);
      const from = current < 0 ? 0 : current;
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const next = (from + delta + panels.length) % panels.length;
      focusPanelId = panels[next].id;
      focusSection = "main";
      // Scroll the newly focused panel into view if it's off-screen in the
      // horizontally-scrollable container. The per-panel wrappers are `content`'s
      // direct children in order, so index `next` is the target; "nearest" is a
      // no-op when it's already visible and avoids vertical movement.
      (content.children[next] as HTMLElement | undefined)?.scrollIntoView({
        behavior: "smooth",
        inline: "nearest",
        block: "nearest",
      });
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });
</script>

<!-- using `z-1` so that insert pile is stacked on top -->
<div
  class="relative z-1 flex min-h-screen w-full items-center overflow-x-auto overflow-y-visible p-4 scroll-px-16"
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
