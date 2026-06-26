import type { Attachment } from "svelte/attachments";

export function detectHoverOnce(
  targetClass: string,
  onHover: (el: HTMLElement) => void,
): Attachment<HTMLElement> {
  return (el) => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !target.classList.contains(targetClass)) return;
      onHover(el);
      el.removeEventListener("mousemove", handler);
    };
    el.addEventListener("mousemove", handler);
    return () => el.removeEventListener("mousemove", handler);
  };
}

// Hold the scroll offsets of `el`'s ancestors (and the window) fixed for
// `durationMs`, undoing any scroll the browser performs in that window. Focusing
// an element + placing a caret makes the browser scroll that caret into view, and
// `focus({preventScroll})` only covers the focus() call — the Selection change
// scrolls too. Pinning across the slide-in animation keeps the viewport from
// yanking when a freshly created check is focused. Self-stopping via rAF; only
// the create-handoff opts in, so ordinary caret navigation still scrolls.
export function pinScroll(el: HTMLElement, durationMs: number): void {
  const nodes: Element[] = [];
  for (let n: Element | null = el; n != null; n = n.parentElement) nodes.push(n);
  const saved = nodes.map((n) => ({ top: n.scrollTop, left: n.scrollLeft }));
  const winTop = window.scrollY;
  const winLeft = window.scrollX;
  const deadline = performance.now() + durationMs;
  const restore = () => {
    nodes.forEach((n, i) => {
      if (n.scrollTop !== saved[i].top) n.scrollTop = saved[i].top;
      if (n.scrollLeft !== saved[i].left) n.scrollLeft = saved[i].left;
    });
    if (window.scrollY !== winTop || window.scrollX !== winLeft) window.scrollTo(winLeft, winTop);
    if (performance.now() < deadline) requestAnimationFrame(restore);
  };
  restore();
}

export const isSafari =
  typeof navigator !== "undefined" &&
  /Safari/.test(navigator.userAgent) &&
  !/Chrome|Chromium|Android/.test(navigator.userAgent);

export const isChromium =
  typeof navigator !== "undefined" && /Chrome|Chromium|Edg|OPR|Brave/.test(navigator.userAgent);

const toLayoutViewport = (rect: DOMRect) => {
  if (!isSafari) return rect;
  const viewport = window.visualViewport;
  if (!viewport) return rect;
  return new DOMRect(
    rect.x + viewport.offsetLeft,
    rect.y + viewport.offsetTop,
    rect.width,
    rect.height,
  );
};

export const getLayoutRect = (el: HTMLElement) => toLayoutViewport(el.getBoundingClientRect());

export const toLayoutPoint = (x: number, y: number) => {
  if (!isSafari) return { x, y };
  const viewport = window.visualViewport;
  if (!viewport) return { x, y };
  return { x: x + viewport.offsetLeft, y: y + viewport.offsetTop };
};

function smoothScroll(el: HTMLElement, to: number, duration: number) {
  const start = el.scrollTop;
  const delta = to - start;
  const t0 = performance.now();

  function frame(t: number) {
    const p = Math.min((t - t0) / duration, 1);
    const eased = p * (2 - p); // easeOutQuad
    el.scrollTop = start + delta * eased;
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

export function scrollWithCallback(
  el: HTMLElement,
  to: number,
  callback: () => void,
  duration: number,
  delay: number | null = null,
) {
  const start = () => smoothScroll(el, to, duration);
  delay == null ? start() : setTimeout(start, delay);
  setTimeout(callback, duration + (delay ?? 0));
}

export const horizontalWheelHijack: Attachment<HTMLDivElement> = (node) => {
  let locked = false;
  let unlockTimer: ReturnType<typeof setTimeout> | null = null;
  const unlock = () => {
    locked = false;
    unlockTimer = null;
  };

  const threshold = 10;
  const onWheel = (ev: WheelEvent) => {
    const { deltaX, deltaY } = ev;
    if (Math.abs(deltaX) <= Math.abs(deltaY)) return;
    if (ev.cancelable) ev.preventDefault();

    if (Math.abs(deltaX) <= threshold) {
      if (unlockTimer != null) {
        clearTimeout(unlockTimer);
        unlock();
      }
      return;
    }
    if (locked === false) {
      locked = true;
      console.log("valid swipe", deltaX > 0 ? "left" : "right");
    }
    if (unlockTimer != null) clearTimeout(unlockTimer);
    unlockTimer = setTimeout(unlock, 150);
  };
  node.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    node.removeEventListener("wheel", onWheel);
    if (unlockTimer != null) clearTimeout(unlockTimer);
  };
};

export const wheelHijack: Attachment<HTMLDivElement> = (node) => {
  const scrollPage = (by: number) => {
    const scroller = document.scrollingElement;
    if (scroller) {
      scroller.scrollTop += by;
    } else {
      window.scrollBy(0, by);
    }
  };
  const handler = (event: WheelEvent) => {
    if (event.deltaY === 0) return;
    const maxScrollLeft = node.scrollWidth - node.clientWidth;
    if (maxScrollLeft <= 0) {
      if (isSafari) scrollPage(event.deltaY);
      return;
    }
    const current = node.scrollLeft;
    let deltaY = event.deltaY;
    if (event.deltaMode === 1) deltaY *= 16;
    if (event.deltaMode === 2) deltaY *= window.innerHeight;
    if (deltaY > 0) {
      const remaining = maxScrollLeft - current;
      if (remaining > 0) {
        const consume = Math.min(remaining, deltaY);
        node.scrollLeft = current + consume;
        const leftover = deltaY - consume;
        if (leftover !== 0) scrollPage(leftover);
      } else {
        scrollPage(deltaY);
      }
    } else {
      const remaining = current;
      if (remaining > 0) {
        const consume = Math.min(remaining, -deltaY);
        node.scrollLeft = current - consume;
        const leftover = -deltaY - consume;
        if (leftover !== 0) scrollPage(-leftover);
      } else {
        scrollPage(deltaY);
      }
    }
    if (event.cancelable) event.preventDefault();
  };
  node.addEventListener("wheel", handler, { passive: false });
  return () => node.removeEventListener("wheel", handler);
};
