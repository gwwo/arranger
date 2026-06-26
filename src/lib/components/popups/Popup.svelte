<script lang="ts" generics="T extends {anchor: HTMLElement}">
  import { tick, untrack, type Snippet } from "svelte";
  import type { Attachment } from "svelte/attachments";

  import { fade, scale } from "svelte/transition";
  import { isSafari, getLayoutRect } from "$lib/utils/dom";

  type Props = {
    content?: Snippet<[arg: T]>;
    class?: string;
    alignX?: "center" | "left";
    alignY?: "bottom" | "top";
    retainAnchorClick?: boolean;
  };

  let { content, alignX = "center", alignY, retainAnchorClick = false }: Props = $props();

  let wrapper: HTMLDivElement | null = $state.raw(null);

  let request: T | null = $state.raw(null);

  let anchorLayoutRect: DOMRect | null = $state.raw(null);
  let popupHeight: number | null = $state(null);

  let alignYAuto: "bottom" | "top" = $state("bottom");

  export const getCurrentArg = () => request;
  export const getAlignY = () => alignYAuto;
  export const show = (arg: T) => {
    request = arg;
    anchorLayoutRect = getLayoutRect(arg.anchor);
    alignYAuto = "bottom";
  };
  export const close = () => {
    request = null;
    anchorLayoutRect = null;
    popupHeight = null;
  };

  let translateX: string | null = $derived.by(() => {
    if (anchorLayoutRect == null || popupHeight == null) return null;
    const { left, right } = anchorLayoutRect;
    return alignX === "center" ? `calc(-50% + ${(left + right) / 2}px)` : `${left}px`;
  });

  const spacing = 4;

  let alignYBest: "bottom" | "top" | null = $derived.by(() => {
    if (alignY) return alignY;
    if (anchorLayoutRect == null || popupHeight == null) return null;
    const { top, bottom } = anchorLayoutRect;
    const layoutVVHeight = document.documentElement.clientHeight;
    const spaceAbove = top;
    const spaceBelow = layoutVVHeight - bottom;
    const fitsBelow = popupHeight + spacing <= spaceBelow;
    const fitsAbove = popupHeight + spacing <= spaceAbove;
    if (fitsBelow !== fitsAbove) return fitsBelow ? "bottom" : "top";
    return null;
  });

  $effect(() => {
    if (alignYBest !== null) alignYAuto = alignYBest;
  });

  let translateY: string | null = $derived.by(() => {
    if (anchorLayoutRect == null || popupHeight == null) return null;
    const { top, bottom } = anchorLayoutRect;
    return `${alignYAuto === "bottom" ? bottom + spacing : top - popupHeight - spacing}px`;
  });

  $effect(() => {
    if (!request) return;
    let rafId: number | null = null;

    const reposition = () => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        if (!request) return;
        anchorLayoutRect = getLayoutRect(request.anchor);
        rafId = null;
      });
    };
    window.addEventListener("scroll", reposition);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
    };
  });

  $effect(() => {
    if (!request) return;
    // We need `clickoutside` to fire after a popup trigger is clicked.
    // Without the lock, it will fire immediately due to the clicking to `show`
    // The best part is that we don't need to worry about the timeout disrupts new request.
    let lock = true;
    setTimeout(() => (lock = false));
    const handleClickOutside = (ev: MouseEvent) => {
      if (lock) return;
      const { target } = ev;
      const clickInPopup = target && wrapper?.contains(target as Node);
      if (clickInPopup) return;
      if (retainAnchorClick) {
        const clickInAnchor = target && request?.anchor.contains(target as Node);
        if (clickInAnchor) return;
      }
      close();
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  });

  const popupResizeObseration: Attachment<HTMLElement> = (el) => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const [{ contentRect }] = entries;
      popupHeight = contentRect.height;
    });
    observer.observe(el);
    return () => observer.disconnect();
  };
</script>

{#if request}
  {#key request}
    <div
      bind:this={wrapper}
      style:transform="translate({translateX}, {translateY})"
      class={[
        "fixed top-0 bottom-0 z-[99] h-fit max-h-[calc(100vh-2rem)] will-change-transform",
        "pointer-events-auto",
      ]}
    >
      <div
        {@attach popupResizeObseration}
        transition:scale|global={{ duration: 250, start: 0.8 }}
        class="size-fit"
      >
        {@render content?.(request)}
      </div>
    </div>
  {/key}
{/if}
