# Guest → signed in

When a guest authenticates client-side (password / OAuth / signup-OTP), the page
transforms in place instead of reloading. The goal is a **three-phase** switch
that never blocks the whole UI on a slow network.

## Three phases (sign-in / pull)

1. **Pending** — old guest panels stay; the sign-in button holds its disabled
   "…" state. Lasts until *both* the user info (`GET /auth/api/me`) and the
   project list (`pullProjList`) resolve — nothing else.
2. **Switch** (one frame) — panel 0 shows the project list in its sidebar with
   the first project selected and a loading placeholder in its main area; extra
   panels close; the sign-in panel flips to the account view. All together.
3. **Stream** — each project / placement view is a stub, fetched lazily the
   first time a panel shows it (the lazy-load `$effect` + `Panel`'s grace/spinner
   timing). Phase-3 content replaces the placeholders as it lands.

`onAuthChange` (`+page.svelte`) pulls **only** the project list, builds the
projects as name-only stubs, marks every project + placement view stubbed, then
restructures the panels. It deliberately does *not* eager-fetch project rows or
placement content — that's what kept the old panels alive until everything
loaded.

## Coordinating the account flip with the panel switch

The account view is driven by `me` in `UserPanel.svelte`; the panel switch is
driven by `onAuthChange` in the page. To land them in the same frame, `loadMe`
**awaits** `onAuthChange` (via `reportAuth`) *before* assigning `me`. So the
button stays busy through the project-list pull, and the account panel + the
panels flip together when it returns.

Sign-up (`newUser`) is the exception: the demo state is already on screen and is
uploaded in the background, so its account flip is **not** gated — revealed
immediately.

## Clean transform, not a resurrection

The switch is always the default `[first project, account]` layout:

- Panel 0: keep its (guest-mutated) layout/dimensions, only swap the instance to
  the first project.
- Account: reuse the existing account panel (its size/spacing persists).
- Extras: closed (`splice(1, …)`).

It does **not** restore a saved arrangement from localStorage here — a guest
sign-in is a clean transform of what's on screen, not a session resume. (The
real signed-in resume — rebuilding the full multi-panel arrangement from the
`panel_comp` cookie + localStorage — still happens on a genuine signed-in page
load, in `onMount`; see `server-render.md`.)

## Persistence

Setting `currentUserId` at the end of the switch fires the persist effects, now
keyed by the new user id: localStorage `panels:<id>` (full per-row state) and the
`panel_comp` cookie (SSR composition) are both **overwritten** with the new
layout. This cleans any stale `panels:<id>` left by a prior session that ended
without an explicit sign-out (sign-out clears it; a lost/expired session does
not). Guests never write either store (`keyFor(null) == null`).
