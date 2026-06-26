<script module>
  import { createContext } from "svelte";
  import Popup from "./Popup.svelte";

  export type PopupArg = {
    // Anchor the bubble next to this element. Omit (and pass `point`) to place
    // the dialog's top-left corner at a fixed-viewport point instead.
    anchor?: HTMLElement;
    // Fixed-viewport coordinates for the dialog's top-left corner.
    point?: { x: number; y: number };
    title: string;
    description?: string;
    // Label for the confirming (destructive) action.
    confirmLabel: string;
    onConfirm: () => void;
  };

  // The anchored path always carries a concrete anchor.
  type AnchoredArg = PopupArg & { anchor: HTMLElement };

  type Confirm = {
    popup: (arg: PopupArg) => void;
  };

  const [useConfirm, setConfirm] = createContext<Confirm>();
  export { useConfirm };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade, scale } from "svelte/transition";

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();
  let popup: Popup<AnchoredArg> | undefined = $state.raw();
  // Point-positioned (anchorless) request: top-left corner placed at `point`.
  let pointReq: PopupArg | null = $state.raw(null);
  // Measured bubble size, used to clamp the point so the whole bubble stays
  // on-screen rather than overflowing the right/bottom edge.
  let bubbleW = $state(0);
  let bubbleH = $state(0);

  const clampedPoint = $derived.by(() => {
    const p = pointReq?.point;
    if (p == null) return { x: 0, y: 0 };
    const margin = 8;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const maxX = Math.max(margin, vw - bubbleW - margin);
    const maxY = Math.max(margin, vh - bubbleH - margin);
    return {
      x: Math.min(Math.max(p.x, margin), maxX),
      y: Math.min(Math.max(p.y, margin), maxY),
    };
  });

  setConfirm({
    popup: (arg) => {
      if (arg.point != null || arg.anchor == null) {
        pointReq = arg;
        return;
      }
      if (popup?.getCurrentArg()?.anchor !== arg.anchor) {
        popup?.show(arg as AnchoredArg);
      }
    },
  });

  const closePoint = () => {
    pointReq = null;
  };
</script>

{@render children()}

{#snippet card(arg: PopupArg, close: () => void)}
  <div
    class="flex w-64 flex-col gap-2 rounded-md border border-gray-200 bg-white p-3 text-sm shadow-lg"
  >
    <p class="font-semibold text-gray-800">{arg.title}</p>
    {#if arg.description}
      <p class="leading-snug text-gray-500">{arg.description}</p>
    {/if}
    <div class="mt-1 flex justify-end gap-2">
      <button class="rounded-md px-3 py-1.5 text-gray-600 hover:bg-gray-100" onclick={close}>
        Cancel
      </button>
      <button
        class="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 active:bg-red-800"
        onclick={() => {
          arg.onConfirm();
          close();
        }}
      >
        {arg.confirmLabel}
      </button>
    </div>
  </div>
{/snippet}

{#if popup?.getCurrentArg() || pointReq}
  <!-- Dimmed scrim behind the confirm bubble (wrappers sit at z-[99]).
       Clicking it falls through to the click-outside handler, which closes. -->
  <div class="fixed inset-0 z-98 bg-black/20" transition:fade={{ duration: 150 }}></div>
{/if}

<Popup bind:this={popup} retainAnchorClick>
  {#snippet content(arg: AnchoredArg)}
    {@render card(arg, () => popup?.close())}
  {/snippet}
</Popup>

{#if pointReq}
  {@const req = pointReq}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-99" onclick={closePoint}>
    <div
      class="fixed origin-top-left"
      bind:clientWidth={bubbleW}
      bind:clientHeight={bubbleH}
      style:top="{clampedPoint.y}px"
      style:left="{clampedPoint.x}px"
      transition:scale|global={{ duration: 250, start: 0.8 }}
      onclick={(e) => e.stopPropagation()}
    >
      {@render card(req, closePoint)}
    </div>
  </div>
{/if}
