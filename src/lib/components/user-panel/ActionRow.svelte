<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ClassValue } from "svelte/elements";
  import { ViewSwitch } from "$lib";

  // Same animation primitives as TodoList's row swap: ViewSwitch's CSS
  // height transition (ease) plus svelte `transition:fade` (linear) for
  // opacity. The two finish at the same time (both 200ms), but opacity
  // catches up gradually rather than snapping to ~1 early — so the form
  // doesn't "look done" before the row has finished growing.
  //
  // The title button is rendered in BOTH ViewSwitch branches at the same
  // position, so during the cross-fade old and new title overlap pixel-
  // perfectly and the label doesn't ghost-shift. Only the form below the
  // title is conditionally rendered.
  type Variant = "default" | "danger" | "warning";

  type Props = {
    expanded?: boolean;
    onclick?: (ev: MouseEvent) => void;
    disabled?: boolean;
    variant?: Variant;
    rowClass?: ClassValue;
    label: Snippet;
    expandedContent?: Snippet;
  };

  let {
    expanded = false,
    onclick,
    disabled,
    variant = "default",
    rowClass,
    label,
    expandedContent,
  }: Props = $props();

  let rootEl: HTMLDivElement | undefined;
  let viewSwitch: ViewSwitch<boolean> | undefined;

  let collapsing = $state(false);
  let lastSeenExpanded = false;
  $effect.pre(() => {
    if (lastSeenExpanded && !expanded) collapsing = true;
    lastSeenExpanded = expanded;
  });

  // py-3 (24px) + h-8 button (32px) on top of ViewSwitch content
  export const getEl = () => rootEl;
  export const getEndHeight = () => (viewSwitch?.getEndHeight() ?? 0) + 56;

  const labelText = $derived(
    variant === "danger"
      ? "text-red-700"
      : variant === "warning"
        ? "text-amber-800"
        : "text-neutral-700",
  );
  const expandedBg = $derived(
    variant === "danger" ? "bg-red-50" : variant === "warning" ? "bg-amber-50" : "bg-white",
  );

  const titleClass = $derived([
    "flex h-8 w-full items-center rounded-md px-3 text-sm",
    labelText,
    "cursor-pointer hover:bg-black/5 disabled:opacity-50",
    rowClass,
  ]);
</script>

<div bind:this={rootEl} class="relative">
  {#if expanded}
    <!-- svelte-ignore a11y_consider_explicit_label -->
    <button
      type="button"
      class="absolute inset-x-0 -top-7.5 -bottom-7.5"
      aria-label="Collapse"
      onmousedown={() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }}
      {onclick}
    ></button>
  {/if}
  <div
    ontransitionend={collapsing
      ? (e) => {
          if (e.propertyName !== "background-color") return;
          collapsing = false;
        }
      : null}
    class={[
      "relative h-fit overflow-hidden rounded-md",
      expanded ? `${expandedBg} px-2 py-3 shadow-lg` : "mx-2",
      (expanded || collapsing) &&
        "transition-[margin,padding,background-color,box-shadow] duration-200",
    ]}
  >
    <button type="button" {disabled} class={titleClass} {onclick}>
      <span class="min-w-0 truncate">{@render label()}</span>
    </button>
    <ViewSwitch bind:this={viewSwitch} key={expanded} duration={200}>
      {#if expanded}
        <div class="px-3 pt-1 [&_button]:cursor-pointer">{@render expandedContent?.()}</div>
      {/if}
    </ViewSwitch>
  </div>
</div>
