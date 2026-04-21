import { cubicIn, cubicOut } from "svelte/easing";

export const splitFrom = (
  node: HTMLDivElement,
  params: { peer?: HTMLElement | null; duration?: number },
) => {
  const { peer, duration = 400 } = params;
  const resolvedPeer = peer ?? (node.previousElementSibling as HTMLElement | null);
  if (!resolvedPeer) return {};
  const nodeEnter = node.getBoundingClientRect();
  node.style.display = "none";
  const peerOriginal = resolvedPeer.getBoundingClientRect();
  node.style.display = "";

  const dx = peerOriginal.left - nodeEnter.left;

  const animation = node.animate(
    [{ transform: `translateX(${dx}px) scale(0.8)` }, { transform: `translateX(0) scale(1)` }],
    {
      duration,
      easing: "ease", // cubicOut
    },
  );
  return {};
  // return {
  //     duration,
  //     easing: cubicOut,
  //     css: (t: number, u: number) => `transform: translateX(${u * dx}px) scale(${1 - 0.2 * u});`,
  // };
};

import type { AnimationConfig, FlipParams } from "svelte/animate";

export function flip(
  node: Element,
  { from, to }: { from: DOMRect; to: DOMRect },
  params: FlipParams = {},
): AnimationConfig {
  const { duration = (d: number) => Math.sqrt(d) * 120 } = params;

  const dx = from.left - to.left;
  const dy = from.top - to.top;

  const dist = Math.sqrt(dx * dx + dy * dy);
  const dur = typeof duration === "function" ? duration(dist) : duration;

  // there's performance hit in safari leading to flickers when using svelte's built-in mechanism
  node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: `translate(0, 0)` }], {
    duration: dur,
    easing: "ease",
  });

  return {};
}
