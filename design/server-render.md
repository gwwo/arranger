# Server-rendering `/`

**Three-phase loading** (guest and signed-in alike): skeleton (fallback during
slow HTML download) → panels revealed all at once at parse-end → "Making
interactive" until hydration.

## Guest

- Served from a **cached SSR snapshot** — rendered once, reused for every guest.
- Demo entities get deterministic `guest-` IDs → remapped to fresh UUIDs at sign-up.

## Signed-in

`/` is **dynamically server-rendered per request** (not cached).

- **Panel composition → `panel_comp` cookie.** Each panel's layout (dimensions,
  left margin, sidebar visibility) and what it shows (project / placement /
  operation). Lets the server render the panels "skeleton with visible flesh"
  and prefetch the content for exactly those scopes.
- **Per-row UI state → localStorage.** `rowSelected` / `todoExpanded` and
  placement selection/expansion — too big for a cookie, not needed for the first
  paint. Overlaid onto the already-rendered panels during hydration by
  reassigning the row-state fields only, so no panel view remounts.
- **Account panel** SSRs the real account view from `data.me` (the requesting
  user's own info — request-scoped, as safe to render as their projects). It's
  cached in module state for client remount survival, but re-seeded per request
  on the server before the panel renders; SSR renders are synchronous and
  serialized, so one request's `me` can't leak into another's render.
- **Sync icon** seeds `syncStatus.pinnedUserId` during render so a signed-in
  page paints its "synced" state from the first frame, not the demo-mode
  "offline" look until `initSync` runs in `onMount`.


# Server-rendering `/auth/otp`, `/auth/reset`

Each resolves its token (`vt` / `ct`) in `+page.server.ts` and renders its final
state — the code / new-password form, or the invalid/verified notice — instead
of a "Loading…" placeholder that only resolved after a client fetch. The GET
destination APIs still exist: the OTP page re-hits its one on a persisted
`pageshow` to re-validate the token after an iOS bfcache restore.