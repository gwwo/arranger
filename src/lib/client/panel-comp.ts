// The composition of the open panels — each panel's size/position and which
// project / placement / operation it shows — persisted in a cookie so the SSR
// page load can render the panels server-side ("the skeleton with visible
// flesh") instead of waiting for the client to read localStorage. Deliberately
// excludes per-row UI state (row selection / expansion): that's larger, would
// bloat the cookie, and isn't needed for the initial paint — it's kept in
// localStorage (see panels-storage.ts) and restored during hydration.
//
// Signed-in only — guests render from the deterministic mock panels. The server
// also derives its prefetch set (which projects/placements to load) from this,
// so it's the single source of truth for "what was open".
//
// Shared between client (writes the cookie) and server (reads it), so it must
// stay free of browser-only globals at module scope.

import {
  isPlacementInstance,
  isProjectInstance,
  type PanelItem,
  type PanelLayout,
  type PlacementName,
  type SimpleOperation,
} from "./model";

export const PANEL_COMP_COOKIE = "panel_comp";

// Roughly the browser per-cookie ceiling (4 KB) with headroom for the name,
// encoding overhead, and other cookies. A composition past this is dropped
// rather than written truncated/corrupt — the server then falls back to the
// default main panel, which is a graceful degradation.
const MAX_COOKIE_BYTES = 3500;

const PLACEMENTS = new Set<PlacementName>(["inbox", "archive", "trash"]);
const OPERATIONS = new Set<SimpleOperation>(["planned", "search", "account"]);

// What a panel shows, reduced to bare identity (no per-row UI state).
export type PanelContent =
  | { t: "project"; projectId: string; placement?: "archive" | "trash" }
  | { t: "placement"; name: PlacementName }
  | { t: "operation"; op: SimpleOperation };

export type PanelCompEntry = {
  id: string;
  layout: PanelLayout;
  content: PanelContent;
};

export type PanelComposition = PanelCompEntry[];

const layoutOf = (l: PanelLayout): PanelLayout => ({
  mainWidth: l.mainWidth,
  height: l.height,
  sideShow: l.sideShow,
  sideWidth: l.sideWidth,
  spacerLeft: l.spacerLeft,
});

// Reads the same reactive fields serializePanels does, so calling it inside an
// $effect registers the dependencies (Svelte 5 proxies only track reads).
export const serializePanelComp = (
  panels: PanelItem[],
  openProjPlacement: Map<string, "archive" | "trash">,
): PanelComposition =>
  panels.map((p) => {
    const inst = p.instance;
    let content: PanelContent;
    if (isProjectInstance(inst)) {
      const placement = openProjPlacement.get(inst.project.id);
      content = { t: "project", projectId: inst.project.id, ...(placement && { placement }) };
    } else if (isPlacementInstance(inst)) {
      content = { t: "placement", name: inst.kind };
    } else {
      content = { t: "operation", op: inst };
    }
    return { id: p.id, layout: layoutOf(p.layout), content };
  });

// The scopes (projects + placements) the composition shows, deduped — what the
// server prefetches so a reload paints those instantly.
export const scopesOf = (
  comp: PanelComposition,
): { projects: string[]; placements: PlacementName[] } => {
  const projects = new Set<string>();
  const placements = new Set<PlacementName>();
  for (const e of comp) {
    if (e.content.t === "project") projects.add(e.content.projectId);
    else if (e.content.t === "placement") placements.add(e.content.name);
  }
  return { projects: [...projects], placements: [...placements] };
};

// ─── (de)serialization ────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const parseLayout = (raw: unknown): PanelLayout | null => {
  if (raw == null || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  const sideWidth = l.sideWidth === "disabled" || isNum(l.sideWidth) ? l.sideWidth : null;
  const spacerLeft = l.spacerLeft === "disabled" || isNum(l.spacerLeft) ? l.spacerLeft : null;
  if (
    !isNum(l.mainWidth) ||
    !isNum(l.height) ||
    typeof l.sideShow !== "boolean" ||
    sideWidth === null ||
    spacerLeft === null
  ) {
    return null;
  }
  return { mainWidth: l.mainWidth, height: l.height, sideShow: l.sideShow, sideWidth, spacerLeft };
};

const parseContent = (raw: unknown): PanelContent | null => {
  if (raw == null || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (c.t === "project" && typeof c.projectId === "string") {
    const placement =
      c.placement === "archive" || c.placement === "trash" ? c.placement : undefined;
    return { t: "project", projectId: c.projectId, ...(placement && { placement }) };
  }
  if (c.t === "placement" && PLACEMENTS.has(c.name as PlacementName)) {
    return { t: "placement", name: c.name as PlacementName };
  }
  if (c.t === "operation" && OPERATIONS.has(c.op as SimpleOperation)) {
    return { t: "operation", op: c.op as SimpleOperation };
  }
  return null;
};

// Tolerant: returns null on anything unexpected so the caller falls back to its
// default (render the default main panel / prefetch the first project).
export const parsePanelComp = (raw: string | undefined | null): PanelComposition | null => {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: PanelComposition = [];
  for (const entry of parsed) {
    if (entry == null || typeof entry !== "object") continue;
    const { id, layout, content } = entry as Record<string, unknown>;
    if (typeof id !== "string") continue;
    const l = parseLayout(layout);
    const c = parseContent(content);
    if (l == null || c == null) continue;
    out.push({ id, layout: l, content: c });
  }
  return out.length > 0 ? out : null;
};

// ─── cookie I/O (browser only) ──────────────────────────────────────────────

export const writePanelCompCookie = (comp: PanelComposition) => {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(JSON.stringify(comp));
  if (value.length > MAX_COOKIE_BYTES) {
    // Too large to store safely — clear any stale value so the server doesn't
    // render a now-wrong composition, and fall back to the default main panel.
    clearPanelCompCookie();
    return;
  }
  // One year; refreshed on every composition change anyway.
  document.cookie = `${PANEL_COMP_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
};

export const clearPanelCompCookie = () => {
  if (typeof document === "undefined") return;
  document.cookie = `${PANEL_COMP_COOKIE}=; path=/; max-age=0; samesite=lax`;
};
