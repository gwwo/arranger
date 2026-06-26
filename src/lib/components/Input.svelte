<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { pinScroll } from "$lib/utils/dom";
  type Props = {
    value?: string;
    placeholder?: string;
    class?: string | (string | boolean | null | undefined)[];
    updateOnBlur?: boolean;
    disabled?: boolean;
    onNavigateOut?: (
      direction: "up" | "down",
      preferredX: number | undefined,
      ev: KeyboardEvent,
    ) => void;
  } & HTMLAttributes<HTMLDivElement>;

  let {
    value = $bindable(""),
    placeholder,
    class: className,
    updateOnBlur,
    disabled,
    onkeydown,
    onblur,
    onNavigateOut,
    ...restProps
  }: Props = $props();

  let current = $state(value);

  // True only while `current` holds unsynced USER keystrokes. Set when the user
  // edits; cleared whenever `value` is synced into `current` (external change /
  // blur). A `current !== value` divergence on its own is NOT enough to mean a
  // pending edit: the bound `value` can change underneath us when a parent swaps
  // the bound entity as it tears this input down (e.g. switching projects via
  // `{#key displayed}` — the live `value` getter already points at the new
  // project while `current` still holds the old one). Flushing that on unmount
  // would record a spurious mutation and spin the sync indicator.
  let dirty = false;

  // Defense-in-depth: in updateOnBlur mode, flush the pending edit on unmount.
  // The contenteditable's onblur usually catches it, but a parent that tears
  // down the input on click (e.g. a collapse overlay) can race with focus
  // change — relying on blur alone can drop the latest keystrokes. Gate on
  // `dirty` so only genuine pending keystrokes flush, never a stale snapshot.
  $effect(() => {
    return () => {
      if (updateOnBlur && dirty && current !== value) value = current;
    };
  });

  // The following is redundant: when disabled becomes true, the editable div is unmounted,
  // which fires blur on the focused element, and the onblur handler already syncs value ← current.
  // // if disabled while an updateOnBlur flush is still pending, sync value back to current
  // $effect.pre(() => {
  //   if (disabled && untrack(() => value !== current)) {
  //     tick().then(() => (value = current));
  //     // defer to avoid interfering with other inputs checking value !== current in the same flush
  //   }
  // });

  let element: HTMLDivElement | null = $state.raw(null);

  const isRangeWithinElement = (range: Range) => {
    if (element == null) return false;
    return element.contains(range.startContainer) && element.contains(range.endContainer);
  };

  const measureTextBefore = (node: Node, offset: number) => {
    if (element == null) return 0;
    const range = document.createRange();
    range.setStart(element, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  };

  // TODO: `getCaretPosition` and `setCaretPosition` only deal with element.childNodes being a solo Text Node.
  // So must ensure there's not line breaks in `current`.
  export const getCaretPosition = (): number | undefined => {
    if (element == null) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!isRangeWithinElement(range)) return;
    return measureTextBefore(range.startContainer, range.startOffset);
  };

  export const getSelectionRange = (): { start: number; end: number } | undefined => {
    if (element == null) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!isRangeWithinElement(range)) return;
    return {
      start: measureTextBefore(range.startContainer, range.startOffset),
      end: measureTextBefore(range.endContainer, range.endOffset),
    };
  };

  export const setCaretPosition = (
    position: number | "start" | "end",
    opts?: { noScroll?: boolean },
  ) => {
    if (element == null) return;
    // Pin the surrounding scroll before focusing so the browser's caret-into-view
    // scroll (which preventScroll alone doesn't fully suppress) can't yank the
    // viewport — used when a fresh check is focused mid slide-in.
    if (opts?.noScroll) pinScroll(element, 300);
    element.focus({ preventScroll: opts?.noScroll });
    const selection = window.getSelection();
    if (!selection) return;
    const offset = position === "start" ? 0 : position === "end" ? current.length : position;
    const range = document.createRange();
    const textNode = element.firstChild || element;
    range.setStart(textNode, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const checkCaretAt = (line: "top" | "bottom"): boolean => {
    if (element == null) return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return true;

    const range = selection.getRangeAt(0);
    const rangeExtended = document.createRange();

    if (line === "top") {
      rangeExtended.setStart(element, 0);
      rangeExtended.setEnd(range.startContainer, range.startOffset);
    } else {
      rangeExtended.setStart(range.endContainer, range.endOffset);
      rangeExtended.setEnd(element, element.childNodes.length);
    }

    const rects = rangeExtended.getClientRects();
    if (rects.length === 0 || rects.length === 1) return true;

    // If we have multiple rects, we're not on the last line
    return false;
  };

  export const moveCaretToX = (preferredX: number | undefined, near: "top" | "bottom") => {
    if (element == null) return;
    if (preferredX == undefined) {
      setCaretPosition("end");
      return;
    }
    const selection = window.getSelection();
    if (!selection) return;
    const { childNodes } = element;
    if (childNodes.length === 0) {
      setCaretPosition("start");
      return;
    }
    const range = document.createRange();

    let best: { node: Text; offset: number; distance: number } | null = null;
    let index = near === "top" ? 0 : childNodes.length - 1;

    for (; index >= 0 && index < childNodes.length; index += near === "top" ? 1 : -1) {
      const child = childNodes[index];
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const node = child as Text;

      let offset = near === "top" ? 0 : node.length;
      for (; offset >= 0 && offset <= node.length; offset += near === "top" ? 1 : -1) {
        range.setStart(node, offset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        const rect = range.getBoundingClientRect();
        const distance = Math.abs(rect.left - preferredX);

        if (best == null || distance <= best.distance) {
          best = { node, offset, distance };
        } else {
          range.setStart(best.node, best.offset);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
      }
    }
  };

  const getCaretX = (): number | undefined => {
    if (element == null) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    return rect.left;
  };
</script>

{#if disabled}
  <div
    role="textbox"
    tabindex="0"
    contenteditable="false"
    {...restProps}
    {placeholder}
    class={[
      "relative focus:outline-none",
      className,
      value === "" && "is-empty",
      "before:pointer-events-none before:text-gray-400 [.is-empty]:before:content-[attr(placeholder)]",
    ]}
  >
    {value}
  </div>
{:else}
  <!-- Chrome (Blink): an empty contenteditable initialised via innerText="" has zero height —
       no line box is created until the user types and deletes, at which point Blink inserts a
       <br> sentinel. Spacing rules:
       - mt-* alone on this element or a zero-height wrapper: the parent's height ends right at
         this element's border-top edge, and the ::before placeholder (~1lh tall) immediately
         overflows below it — making it appear as though there is also a bottom margin.
       - my-* is fine: the mb component adds space below the zero-height box, giving the parent
         enough height to contain the ::before overflow.
       - pt-* on a wrapping element is also fine: padding gives the wrapper non-zero height,
         breaks the margin-collapse chain, and keeps the overflow visually contained. -->
  <div
    role="textbox"
    tabindex="0"
    contenteditable="plaintext-only"
    {...restProps}
    bind:this={element}
    bind:innerText={
      () => {
        current = value;
        // External value change reconciled into the buffer — no longer dirty.
        dirty = false;
        return value;
      },
      (v) => {
        current = v === "\n" ? "" : v;
        dirty = true;
        if (!updateOnBlur) value = current;
      }
    }
    onblur={(ev) => {
      if (updateOnBlur) value = current;
      dirty = false;
      onblur?.(ev);
    }}
    onkeydown={(ev) => {
      if (ev.key === "Escape") {
        element?.blur();
      }
      if (onNavigateOut) {
        const outFromTop = ev.key === "ArrowUp" && checkCaretAt("top");
        const outFromBottom = ev.key === "ArrowDown" && checkCaretAt("bottom");
        if (outFromTop || outFromBottom) {
          onNavigateOut(outFromTop ? "up" : "down", getCaretX(), ev);
        }
      }
      onkeydown?.(ev);
    }}
    {placeholder}
    class={[
      "relative focus:outline-none",
      className,
      current === "" && "is-empty",
      "before:pointer-events-none before:text-gray-400 [.is-empty]:before:content-[attr(placeholder)]",
    ]}
  ></div>
{/if}

<!-- <div>{JSON.stringify(current)}</div> -->
