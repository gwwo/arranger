import type { Attachment } from "svelte/attachments";
import { scrollWithCallback } from "$lib/utils/dom";

const expandedSpacing = 30;
const expandDuration = 200;

type Options = {
  /** The id of the row that just expanded, or null when nothing to reveal. */
  rowIdToReveal: () => string | null;
  /** Reset rowIdToReveal back to null. */
  clear: () => void;
  /** The row's box element (the `data-*-row` div wrapping the TodoRow). */
  rowEl: (id: string) => HTMLElement | null | undefined;
  /** The settled height of the TodoRow once expanded (TodoRow.getEndHeight). */
  endHeight: (id: string) => number | null | undefined;
};

/**
 * Attachment for the scrollable DragList that scrolls a freshly-expanded todo
 * row into view. Mirrors the reveal behaviour of the ordinary project view
 * (TodoList) and the user panel (UserView): it predicts the row's settled
 * layout from TodoRow.getEndHeight so the scroll can start while the expand
 * animation is still running.
 */
export function revealOnExpand(opts: Options): Attachment<HTMLElement> {
  return (node) => {
    $effect(() => {
      const id = opts.rowIdToReveal();
      if (id == null) return;
      // The expanded TodoRow + its element binding aren't settled in the same
      // microtask the id is set, so defer a tick before measuring.
      setTimeout(() => {
        const el = opts.rowEl(id);
        const end = opts.endHeight(id);
        if (!el || end == null) {
          opts.clear();
          return;
        }

        const containerRect = node.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        // The DragList wrapper (el.parentElement) carries the final margin-top
        // inline, but its CSS transition means the computed value still lags.
        // Correct elTop by the difference so it reflects the settled layout.
        const wrapper = el.parentElement;
        const wrapperInlineMargin = parseFloat(wrapper?.style.marginTop ?? "0") || 0;
        const wrapperComputedMargin = wrapper
          ? parseFloat(getComputedStyle(wrapper).marginTop)
          : 0;
        const marginCorrection = wrapperInlineMargin - wrapperComputedMargin;
        const elTop = elRect.top - containerRect.top + node.scrollTop + marginCorrection;

        const top = elTop - expandedSpacing;
        // The row box adds py-2 (16px) padding around the TodoRow when expanded.
        const bottom = elTop + 16 + end + expandedSpacing;

        const viewTop = node.scrollTop;
        const viewBottom = node.clientHeight + viewTop;
        if (top >= viewTop && bottom <= viewBottom) {
          opts.clear();
          return;
        }

        const isRowTall = bottom - top >= node.clientHeight;
        const isRowOutsideView = top >= viewBottom || bottom <= viewTop;
        const isRowOverlapsBottom = top < viewBottom && bottom > viewBottom;

        const target = isRowTall
          ? top
          : isRowOutsideView
            ? (top + bottom - node.clientHeight) / 2
            : isRowOverlapsBottom
              ? bottom - node.clientHeight
              : top;

        const maxScrollTopNow = node.scrollHeight - node.clientHeight;
        const delay = target >= maxScrollTopNow ? expandDuration : null;
        scrollWithCallback(node, target, opts.clear, expandDuration, delay);
      });
    });
  };
}
