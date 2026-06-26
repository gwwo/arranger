// The set of scopes (active projects + placement views) currently shown by the
// open panels. Persisted in a cookie so the SSR page load can prefetch exactly
// the content the user was looking at — keeping reload instant for those while
// every other project/placement is fetched lazily on demand.
//
// This module is shared between client (writes the cookie) and server (reads
// it), so it must stay free of browser-only globals at module scope.

import type { PlacementName } from "./model";

export const OPEN_SCOPES_COOKIE = "open_scopes";

export type OpenScopes = {
  // Project ids shown by the open panels — active or drilled into from
  // archive/trash. The server fetches each by id and reports where it lives.
  projects: string[];
  // Placement views (inbox/archive/trash) shown by the open panels.
  placements: PlacementName[];
};

const PLACEMENTS = new Set<PlacementName>(["inbox", "archive", "trash"]);

export const serializeOpenScopes = (scopes: OpenScopes): string =>
  JSON.stringify({ projects: scopes.projects, placements: scopes.placements });

// Tolerant parse: returns null on anything unexpected so the caller falls back
// to its default (prefetch nothing / just the first project).
export const parseOpenScopes = (raw: string | undefined | null): OpenScopes | null => {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object") return null;
  const { projects, placements } = parsed as Partial<OpenScopes>;
  if (!Array.isArray(projects) || !Array.isArray(placements)) return null;
  return {
    projects: projects.filter((p): p is string => typeof p === "string"),
    placements: placements.filter((p): p is PlacementName => PLACEMENTS.has(p as PlacementName)),
  };
};

// Best-effort cookie write from the browser. Mirrors the localStorage panel
// write; only the scope identity is stored (no content), so it stays tiny.
export const writeOpenScopesCookie = (scopes: OpenScopes) => {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(serializeOpenScopes(scopes));
  // One year; the value is refreshed on every panel change anyway.
  document.cookie = `${OPEN_SCOPES_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
};

export const clearOpenScopesCookie = () => {
  if (typeof document === "undefined") return;
  document.cookie = `${OPEN_SCOPES_COOKIE}=; path=/; max-age=0; samesite=lax`;
};
