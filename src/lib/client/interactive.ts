// Marks <html> interactive (revealing the panels and hiding app.html's status
// banner), but keeps the "Making page interactive…" banner up for a minimum
// time first. On fast/cached loads hydration is near-instant, so without this
// the banner switches from "Rendering" to "Making interactive" and vanishes in
// a couple of frames — a flicker. We hold it for at least the minimum, measured
// from when the parse-end script set `panels-ready` (when that banner appears).

// Minimum visible time, in ms, for the "Making page interactive…" banner.
const MIN_INTERACTIVE_BANNER_MS = 300;

declare global {
  interface Window {
    // Set by app.html's parse-end script: when `panels-ready` was added, i.e.
    // when the "Making page interactive…" phase began. `performance.now()`.
    __panelsReadyAt?: number;
  }
}

let scheduled = false;

// Reveal the panels and mark the page interactive once handlers are attached.
// Idempotent and safe to call from multiple onMounts (child page + root layout).
export function markInteractive(): void {
  const root = document.documentElement;
  if (scheduled || root.classList.contains("interactive")) return;
  scheduled = true;

  // Fallback for loads where the parse-end script hasn't recorded a timestamp
  // (e.g. it's also adding panels-ready here): start the phase now.
  if (window.__panelsReadyAt == null) window.__panelsReadyAt = performance.now();
  root.classList.add("panels-ready");

  const remaining = MIN_INTERACTIVE_BANNER_MS - (performance.now() - window.__panelsReadyAt);
  if (remaining <= 0) {
    root.classList.add("interactive");
  } else {
    setTimeout(() => root.classList.add("interactive"), remaining);
  }
}
