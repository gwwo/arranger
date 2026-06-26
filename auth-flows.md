

## Concepts and Principles

A user holds 1+ **credentials**, each drawn from `{ password, google }`, at most one of each provider. The two kinds are referred to as the **password credential** and the **Google credential** throughout this doc.

The **password credential**, if present, defines the user's *correspondent email* — the only address we ever send mail to. OAuth-provided emails (e.g. Google's `email` claim) are not used. An email address is **registered** if a password credential exists at that address; at most one password credential per address. The design defends against registration-state enumeration.

A user with a password credential has always verified that email. There is no "unverified password credential" state — verification happens before the credential is written. If the password credential is present, the password is the only path to sensitive actions (change email, change password, delete password credential, delete user).

A user with a password credential may also disable `reset-password-via-email`, after which password loss is unrecoverable unless a Google credential is linked (Google sign-in → re-enable reset → reset).

**Enable/disable-reset gating.** Disable is gated on password re-entry. Re-enable is **not** password-gated — the recovery chain above depends on a Google-linked user being able to flip it back on without the password they've lost — but it does require a fresh session, so a hijacked stale session can't silently widen the recovery surface. A Google-only user with a stale session reaches freshness by re-signing-in through Google (`prompt=login`); a password-credential user simply re-signs-in.

**Schema sketch.** `user` row has a nullable, unique `email` column. The invariant tying it to the password credential: `user.email IS NOT NULL` ⟺ this user has exactly one `credential` row with `providerId='password'` (password hash + bookkeeping). The credential's email lives *only* on `user.email` — `credential.accountId` and `credential.email` are both NULL on password credential rows, since there's no external-provider id to record. Lookups use `(credential.userId, providerId='password')`. Google credentials live in their own `credential` rows with `accountId` = Google's `sub`; the OAuth `email` claim is stored on `credential.email` and never copied onto `user.email`.


## Reverse-email-OTP Primitive

### Elements
- **Originator page** (the browser that initiated): displays a 4-digit `otp` and three controls — *cancel*, *get new code*, *proceed*. Surfaces nothing about server state during the wait.
- **Email**: contains a stable link with embedded `verifier-token`.
- **Destination page** (after click the link): code-entry form. Surfaces `INVALID_OR_EXPIRED` ("launch a new one"), `WRONG_CODE`, `TOO_MANY_ATTEMPTS` ("get a new code").

### State
A `verification` row: `{ actor-token, verifier-token, otp, attempts, ttl, type, email, verified, origin-user-id? }`.

- `actor-token` is returned to the originator and held client-side.
- `verifier-token` is embedded in the email link.
- `verified` flips true only when the destination posts the correct `otp` for that `verifier-token` within `attempts`/`ttl`.
- `origin-user-id` is set only in signed-in flows (change-email §3, add-password-cred §7) — it records who started the flow. At `proceed`, the server rejects unless `session.user.id === row.origin-user-id`. Defends against the user signing into a different account between start and proceed (otherwise the commit would silently retarget). Mismatch returns fail without consuming the row — same as any other failed proceed, since a verified-but-uncommitted row ages out via TTL exactly like an unvisited one.

what if the verifier page is opened at a browser where another user is signed in.
it should only concern itself with verifying the verification row

### reverse OTP vs. classic OTP

At the destination, possession of `verifier-token` already proves inbox control. The OTP only needs to bind the destination's verifier to the originator session — a 4-digit code suffices because brute force is bounded by `attempts`, and the only party positioned to attempt it is the verifier themselves (a rare adversary). In a sense, classic OTP bundles inbox-control proof and originator-binding into one 6-digit code; reverse-OTP splits them — `verifier-token` carries the first, OTP carries the second.

Classic email-OTP has to keep a real verification alive even for ignored cases (existing-email sign-up, nonexistent-email reset, reset-disabled), because `TOO_MANY_ATTEMPTS` must surface on the real path, so synthetic paths must surface it too for enumeration defense. An automated OTP-refresh would otherwise confuse the real-path user (whose received code would silently stop matching).

Reverse-OTP avoids this. For an ignored case, the server returns a **synthetic actor-token** (no row created, no email sent) and answers the originator's controls as if a row existed in the !verified state:

| Row state | get new code | proceed |
|---|---|---|
| `verified`, fresh | `verified` — "Already verified — press Proceed" | `success`; row deleted |
| `verified`, expired | `expired` — terminal, "Expired — please start over"; row deleted | `expired`; row deleted |
| `!verified`, expired | `ok` — UI-only fresh OTP (the verifier-side surfaces expiry on the destination page) | `fail`; row alive  |
| `!verified`, fresh | `ok` — real rotate (resets attempts, no email) | `fail` |
| no row (synthetic / canceled)  | `ok` — UI-only fresh OTP  | `fail` |

Surfacing `expired` when `verified` is safe — an originator-only attacker (no inbox access) can never drive the row into `verified`. 

A failed proceed leaves the row alive, so a "pressed Proceed too early" originator can retry once the verifier completes. 

The server rate-limits proceed and rotate via an in-memory `actionCooldown` map keyed by `${action}:${actorToken}` — proceed = 5s, rotate = 30s. Hits return `{ kind: "too_frequent", retryAfterMs }`; the client mirrors with per-action Cooldown timers. The limiter is keyed only by `${action}:${actorToken}` and runs before any row lookup, so a quick second click returns too_frequent regardless of row state — bypassing the UI cooldown gains no information.

### Originator-side commit
Action payloads are *not* stored on the verification row. The originator submits `{ actor-token, payload }` at "proceed".

Server gate: row exists, `verified === true`, within TTL. Then dispatches the commit on `row.type`

**Caveat**: a phishing originator that captures an actor-token and otp can induce the user to complete OTP entry and then submit its own payload. For sign-up shape this is benign — the attacker only squats an email address, which the rightful owner can reclaim via the reset flow. The destructive-overwrite case (password reset) doesn't use this primitive (see *Controller-token shape*) so phishing-originator never lands on a destructive commit.

## Controller-token Primitives

Single-use, destination-side commit. Server mints a `{ controller-token, ttl, email, type, origin_user_id? }` row and emails a link straight to the destination. No OTP, no originator state, no enumeration defense to maintain on an originator screen — the originator just renders "if there's an account, you'll get an email" uniformly. The destination form collects the action payload (the user types it there) and posts `{ controller-token, payload }`; submit consumes the row.

For controller-tokens minted in **signed-in** flows (change email, add password credential via the escape hatch), the row carries `origin_user_id`. The destination requires a matching session and rejects unless `session.user.id === row.origin_user_id`; if the user clicks the link in a browser without a session, the destination prompts sign-in first, then re-checks. Unsigned-in controller-tokens have no such binding — the row's `email` is the only identifier.

Two uses:

1. **Primary path for password reset** Ensures only the real inbox owner can submit the payload (mentioned in the caveat above). Additionally, an attacker with inbox access could initiate reverse-OTP themselves and play both sides anyway, so the OTP step adds UX cost without security the shape doesn't already provide.

2. **Per-email daily-send escape hatch**. For the reset flow and for the sign-up-shape flows (sign-up, change email, add password credential). A per-email counter on *real* outbound emails — synthetic-actor-token paths don't count — trips at a daily threshold N. The (N+1)th request switches that day's final email to a controller-token link carrying the same `type` as the verification it replaces (`signup` / `change-email` / `add-password-cred` / `reset`), so the destination route can dispatch the correct commit. Further requests for that email in the same day return synthetic actor-tokens with no email sent at all.

   The switch is **not surfaced on the originator screen**. Doing so would confirm "you're on the real branch" (synthetic paths never reach N+1), which is the registration-state oracle the synthetic-actor-token machinery exists to suppress. Instead, the signal is carried by the (N+1)th email itself — its subject/body announces it as the final attempt of the day, e.g. *"This is the final email for {email} today — there have been too many attempts. Please use this link to complete the action; further requests today will be ignored."* The legitimate inbox owner sees this and adapts; a third-party originator without inbox access learns nothing.

## Flows


```
email:    email@example.com
password: xxxxx     ← row hidden when toggle is on

[x] password forgotten?

[[continue]]
```

### 1. unified email/password sign-in

Originator posts `{ email, password }`. Server: sign-in is the default action; a sign-in miss auto-transitions into reverse-OTP `type=signup` (real or synthetic).


Server resolves the submission:
- email registered + correct password → sign-in.
- otherwise (no user OR wrong password; pad the timing)
  - email unregistered → real reverse-OTP verification row `type=signup`, send email, return real `actor-token` + `otp`.
  - email unregistered, daily per-email contact cap reached → synthetic `actor-token` + `otp`; switch to a final `type=signup` `controller-token` flow if not already.
  - email registered → synthetic `actor-token` + `otp`, no row, no email.
  - surface the page below to the originator

```
Couldn't sign you in to {email} — signing you up instead.

An email may have been sent. Click the link inside and enter the code below.
            [otp]

[[Cancel]]   [[Get a new code]]   [[I've verified. Proceed]]
```

On `proceed`: create `user` + password `credential` row, issue session.

On `cancel`: server deletes the verification row if ever created. client navigates back

The "couldn't sign you in" message itself is the wrong-password user's notification — they realize their password was wrong from the message, not from the inbox wait for a non-coming email. They cancel, and retry or reset the password. The genuine-new-user case is seamless — failure message reads as expected ("you don't have an account yet, we're making one"), they wait for the email, and proceed.

Hash cost for a fresh sign-up via this form: 0 bcrypts at the sign-in attempt (only the pad for on user), 1 real bcrypt at `proceed`. Wrong-password user pays 1 real bcrypt at the sign-in attempt, which is inevitable.


### 2. reset password via email
Originator posts `{ email }`. Server returns a synthetic controller-token (no row, no email) if any of: email unregistered, `reset-password-via-email` disabled on the registered user, or daily per-email send cap reached (in the cap case, send a final cap-notice email with `type=signup` `controller-token` if not already). Else mint `{ controller-token, type=reset, ttl, email }` row and email a link to the address.

Originator renders a uniform "if there's an account, you'll get an email" — identical in real and synthetic paths.

Destination form collects the new password and posts `{ controller-token, newPassword }`. Server swaps the credential hash, deletes the row, revokes other sessions.



### 3. change password credential (signed-in)
Single form: re-enter current password, plus a new-email field (defaulted to the current email) and an optional new-password field (left empty to keep the current password). The submit button is disabled until at least one of email/password actually changes; its label is *Continue* for password-only change and *Continue to verify* when the email differs.

- **Password-only** (email unchanged, new password set): set the new password directly, revoke other sessions. No email step.
- **Email change** (with or without new password): run reverse-OTP `type=change-email` (sign-up shape) against the new email. The new password — if supplied — is **not** sent on the start call (the server would just discard it: payloads aren't stored on the OTP row). The originator stashes it locally, then forwards it in the proceed payload alongside the actor-token. On proceed, the server replaces the credential's email and, if a password rode along, also sets the new hash and revokes other sessions, atomically with the email swap. Phishing-originator caveat is the same as §1: an attacker holding actor-token + otp could submit a different new-password payload, but they could already do this for sign-up — and here the user has just typed the current password into the form, so a phishing originator at this point is already a lost battle.

Enumeration defense and cap-notice escape hatch apply to the new email as in §1.


### 5. google sign-in
Sign-in only here, but the OAuth machinery is **shared by three intents** — `sign-in`, `link` (§6), and `re-sign-in` (the recovery flow). The intent rides in a signed `state` blob, so one start/callback pair serves all three.

**Every Google round-trip uses `prompt=login`** — Google forces re-authentication on its side each time, so the auth is always fresh, and any session issued off the back of it is fresh-by-construction.

1. `GET /user/api/google/start?intent=…&callbackURL=…` (`&uid=…` for `re-sign-in`) mints an HMAC-signed `state = { n (nonce), cb, intent, uid }` and 302s to `accounts.google.com/o/oauth2/v2/auth?…` with `prompt=login`, `access_type=offline`, `scope="openid email profile"`. Our app's `client_id` scopes the `accountId` Google issues — stable per `(app, Google user)`.
2. User authenticates at Google → redirect back to `GET /user/api/google/callback?code=…&state=…`. The callback verifies the `state` HMAC, exchanges `code` at `oauth2.googleapis.com/token`, then reads `userInfo = { sub, email, email_verified, name, picture }` from `openidconnect.googleapis.com/v1/userinfo` — trusted because it came over TLS straight from Google. (We don't verify the `id_token` JWS; the userinfo fetch stands in for it. `sub` is the `accountId`.)
3. The callback dispatches on `state.intent`. For `sign-in`, match `(providerId='google', accountId=sub)`:
  - match → that user; (could refresh OAuth tokens here — skipped in the demo); `createSession`.
  - no match → create a fresh user + Google credential row.
  - no implicit email-link: the OAuth `email` claim is stored on the credential row but is **not** treated as a correspondent email, and the `name` claim is **not** promoted to `user.name`.

### 6. link / delete google credential (signed-in)
Always explicit, client-initiated.

- **Link**: `GET /user/api/google/start?intent=link` — `uid` is taken from the current session. The callback (`intent=link`) requires a live session matching `state.uid`, then attaches the Google credential row to that user **only if** `(providerId='google', accountId=sub)` isn't already attached to *another* user (else `?error=google-already-linked`). Already attached to the current user → no-op.
- **Delete** (`delete-google-cred`): must leave ≥1 credential. Gated like §8 delete-user — a password-credential user re-enters the password (which, as in every password-gated flow, also refreshes the session); a user without one (e.g. Google + another OAuth provider) falls back to a session-freshness check. Then the Google credential row is removed.

**Re-sign-in via Google** (the `re-sign-in` intent, used by the recovery panel — see §"Local user state management"). The client carries the user it wants to re-sign-in as in `state.uid`; the ambient cookie is *not* trusted to pick the user (it may be gone, or hold a different user after a tab-swap). The callback requires the freshly-authenticated Google account to actually be linked to `state.uid` (`matched.userId === state.uid`, else `?error=resign-user-mismatch`), then deletes the cookie's current session row — whoever owned it — and issues a new session for `state.uid`.

### 7. add/delete password credential (signed-in)
- **Add**: runs the reverse-OTP `type=add-password-cred` flow, but on `proceed` attaches the password credential to the *current* user instead of creating a new one. Same enumeration defense — if the chosen email is already registered, the user gets a synthetic actor-token and the proceed fails with no diagnostic. A Google-only user adding a password credential at their own Google-claim email is *not* blocked, since claims aren't registrations.
- **Delete**: re-enter password; must leave ≥1 credential; remove the password credential row and clear `user.email`.

### 8. delete user (signed-in)
- Password-credential user: re-enter password.
- Google-only user: session freshness check. If stale, the user is bounced through Google sign-in with `prompt=login` and lands back with a fresh session.

On success: delete `user`, `session`s, `credential`s.


## Rate Limit Strategy

(draft, unreviewed, currently we keep all rate limit strategies in memory)

One primitive: `(key, window, limit) → allow | { retryAfterMs }`, with a pluggable store. Each call site picks one or more policies; the limiter is the same code.

**Stack independent limits, don't compose keys.** A composite key like `(ip, email, action)` widens the keyspace and weakens the limit — rotate one dimension and the counter resets. Instead, check several single-dimension limits in sequence; first denial wins. Each dimension covers a different threat shape:

- **per-IP (loose)** — one source hammering many emails
- **per-email (tight)** — many sources hammering one email (the account-takeover shape)
- **per-user_id** — identity-bearing requests don't need IP

Loose IP + tight per-email cross-cover: the loose IP avoids locking out CGNAT/office neighbors, the tight per-email catches the focused attack regardless of source. For IPv6, key on `/64` prefix rather than the full address.

**Storage backing follows lifetime and consequence.** In-memory is fine when the counter is short-lived or low-stakes; durable storage is required when the limit is itself a security boundary.

| Limit | Key | Window | Backing |
|---|---|---|---|
| OTP action cooldown (already in §Reverse-OTP) | `${action}:${actorToken}` | 5–30s | in-memory |
| unsigned-in abuse | `ip:${ip}:${action}` | minutes | in-memory (Redis if multi-instance) |
| signed-in abuse | `user:${userId}:${action}` | minutes | in-memory (Redis if multi-instance) |
| per-email burst | `email:${addr}:${action}` | minutes | in-memory (Redis if multi-instance) |
| **per-email daily send cap** | `email:${addr}:${type}:${date}` | 24h | **durable** (DB or Redis with TTL) |

The daily send cap is the one that *must* persist — it gates the controller-token escape hatch (§Controller-token, use 2). Losing it on a deploy would let an attacker reset the counter by waiting for a release. Keying it per-`type` (sign-up, reset, change-email) avoids one flow burning another's daily budget for the same address.

**Per-flow stacking.**

| Flow | Limits to check |
|---|---|
| sign-in / sign-up (§1) | `ip:action` + `email:action` + `email:type:daily` |
| reset request (§2) | `ip:action` + `email:reset` + `email:reset:daily` |
| change email (§3) | `user:action` + `email:action` (against the *new* address) + `email:type:daily` |
| change password (§4) | `user:action` |
| add email/password (§7) | `user:action` + `email:action` + `email:type:daily` |
| OTP originator controls | `actorToken:action` (existing) |


## Local user state management

The signed-in UI (`/user`) is a SPA. Its source of truth is the server — `GET /user/api/me` returns `{ user, credentials, sessionFresh }` — but it can't re-fetch on every render, so it holds a *last-known* copy and tracks how trustworthy that copy is.

### Anchoring

The first `loadMe()` that sees a signed-in user records that user's id as the **anchor**. From then on, a `loadMe()` result is only adopted into local `me` if it's still the anchored user. This stops the UI from silently retargeting at whoever happens to be signed in now (e.g. after a sign-out + sign-in as someone else in another tab — the cookie is shared).

`setMe()` (sign-out) re-anchors: it sets `me` authoritatively and resets the anchor to whatever it was given (`null` on sign-out → the SPA falls back to `<Welcome>`).

### Session status

A single derived status, four values — one vocabulary used everywhere (badge, gating, recovery):

| status | meaning | how it's reached |
|---|---|---|
| `fresh` | valid, within the freshness window | `loadMe` → anchored user, `sessionFresh: true` |
| `stale` | valid, past the window | `loadMe` → anchored user, `sessionFresh: false` |
| `overwritten` | cookie holds a valid session for a **different** user (a swap) | `loadMe` → a user ≠ anchor |
| `invalid` | session gone server-side | `loadMe` → no user, **or** any action returned 401 |

`fresh`/`stale` come straight from the server's `sessionFresh`. `overwritten`/`invalid` are recorded locally (`loadMe`'s anchored-user check, and the 401 interceptor) and override the freshness bit — once we know the cookie isn't ours, the last-fetched `sessionFresh` is meaningless. In the `overwritten`/`invalid` cases `me` is **not** updated — the last-known view stays on screen, flagged.

Sensitive actions (§8 delete-user, §6 delete-google-cred, enable/disable-reset) gate on `fresh`. A `stale` session re-gates via re-sign-in; the others must recover first.

### Action–identity binding

Freshness/password gates aren't enough on their own: in the `overwritten` case the cookie holds a *valid, fresh* session — just for the wrong user — so a freshness-only action (enable-reset, set-name, the Google-only delete-user / delete-google-cred branches) would silently commit against whoever holds the cookie now. Every signed-in action therefore carries `expectedUserId` (the anchored user the SPA means to act on); the server refuses with `409` unless `session.user.id === expectedUserId`. This is the direct-action analogue of the OTP row's `origin-user-id` check (§Reverse-OTP) and the `re-sign-in` intent's `state.uid` check (§5) — same defense, same reason: never let the ambient cookie retarget a committed operation. The client treats the `409` like a `401` — re-pulls `me` (which flags the status `overwritten`), flashes a banner, and preserves the action's typed inputs. Crucially, **neither interceptor force-expands the recovery panel**; only the local status flips, which makes the Group A re-sign-in *button* surface next to the action page. The user clicks it when ready. Auto-expanding mid-action would push the in-flight inputs off-screen and is more disruptive than informative — the button + banner is enough signal.

`sign-out` is anchor-bound on the same principle but uses **local-only-on-mismatch** semantics instead of `409` (see the API section): the user clicked *out*, not *re-enter*, so refusing and forcing re-sign-in would be the wrong UX. The server never deletes a session or clears a cookie that doesn't belong to the anchored user; on a mismatch it just returns ok and the SPA re-anchors locally. The other user keeps their session and their tabs — what the swapped-in user does on their own time is theirs, not the local UI's to undo.

### Recovery — the re-sign-in panel

The re-sign-in **button** surfaces whenever the status isn't `fresh`. Expanding it into the recovery panel is always user-initiated — the button click is the only thing that flips `reSignInOpen`. Mid-action interceptors (`401` → `intercept401`, `409` → `interceptUserMismatch`, `403`-fresh → `interceptStale`) only flip the local status (which surfaces the button) and flash a banner; they never force-expand the panel. The action page's typed inputs are preserved so the user can retry after recovery.

Its behavior is **uniform** — it doesn't branch on status (status only picks the explanatory copy). Both methods carry the anchored **user.id** as the explicit identity, so the server never trusts the ambient cookie to pick the user — and never trusts the *email* to pick the user either, since email-keyed lookup would silently re-sign-in as the new owner if the address has been re-allocated after a delete + re-register:

- **password** — posts `{ password, expectedUserId }` to `re-sign-in`. The server looks up the anchored user by id, verifies the password against *that user's* password credential, and refuses (timing-padded `wrong password`) if the user has since been deleted or the password doesn't match. The email shown in the panel is for the human's benefit only; it isn't on the wire.
- **google** — the §5 `re-sign-in` intent, carrying `uid` in the signed state. The callback refuses unless the freshly-authenticated Google account is linked to that exact user.id (`?error=resign-user-mismatch` otherwise).

On success the server replaces the cookie's current session row — whoever owned it (a stale one of ours, or another user's after a swap) — with a fresh one for the resolved user. This is what makes recovery work identically for `stale`, `overwritten`, and `invalid`.

**Why id and not email.** Anchoring is a commitment to a specific `user.id`. If the address has been re-allocated (account deleted, re-registered at the same email with a new id), an email-keyed `re-sign-in` would authenticate the *new* owner and issue them a session — `loadMe` would then flag `overwritten`, but the cookie has already moved to the wrong user and every subsequent action would `409` against the anchor. Keying on id makes the failure clean: the deleted account simply can't be re-signed-in to, and the user can sign out (which re-anchors to `null`) to start fresh as the new account. Same reason the §5 Google re-sign-in keys on `state.uid` rather than the OAuth `email` claim.



## API

The browser auto-sends the `user-demo.session` cookie on every same-origin request; the "cookie" notes below say what each endpoint actually does with it. Bodies are JSON unless noted. All POSTs go through `/user/api/[op]/+server.ts`; the `me` / `*-destination` GETs share that router.

### Reads
- `GET /user/api/me` — no body. Cookie resolves the signed-in user; returns `{ user: null }` if absent or expired. Returns `{ user, credentials[], sessionFresh }`.
- `GET /user/api/otp-destination?vt={verifierToken}` — verifier-token in query. Cookie ignored (destination tab may be signed in as anyone — see §Reverse-OTP).
- `GET /user/api/reset-destination?ct={controllerToken}` — controller-token in query. Cookie ignored.

### Sign-in shape (no live session needed)
- `POST /user/api/sign-in` — `{ email, password }`. Cookie ignored on entry; replaced on a successful sign-in (auto-signup miss returns an OTP shape, no cookie change).
- `POST /user/api/reset-request` — `{ email }`. Cookie ignored.
- `POST /user/api/reset-submit` — `{ controllerToken, newPassword }`. Cookie ignored; all sessions for the resolved user are revoked.

### OTP controls
- `POST /user/api/otp-rotate` — `{ actorToken }`. Cookie ignored.
- `POST /user/api/otp-cancel` — `{ actorToken }`. Cookie ignored.
- `POST /user/api/otp-attempt` — `{ verifierToken, otp }`. Cookie ignored (called from the destination tab).
- `POST /user/api/otp-proceed` — `{ actorToken, password? }`. The `password` field is the *new* credential's password (not a re-confirmation of an existing one); requirement depends on `row.type`:
  - `signup` — **required**: sets the new user's password credential.
  - `add-password-cred` — **required**: sets the password being attached to the existing user.
  - `change-email` — **optional**: rides along only if the email change was paired with a password change; if present, commits atomically with the email swap and revokes other sessions.

  Cookie's `session.user.id` is matched against the row's `origin-user-id` for signed-in OTP types (`change-email`, `add-password-cred`); mismatch returns `fail` without consuming the row (§Reverse-OTP).

### Session lifecycle
- `POST /user/api/sign-out` — `{ expectedUserId }`. Anchor-bound but with **local-only-on-mismatch** semantics, not the 409 refuse-pattern of the 8 guarded actions:
  - cookie's session matches `expectedUserId` → delete that session row and clear the cookie (real sign-out).
  - cookie holds another user's live session (`overwritten`) → do nothing server-side; never delete a session or cookie that doesn't belong to the anchor.
  - no live session (`invalid`) → clear any orphan cookie token; nothing to delete in the DB.
  Always returns `{ ok: true }`; the client always re-anchors `me` to `null` afterwards (the UI snaps to `<Welcome>`). No auto-reload — if the user wants to see whoever else is now in the cookie, they can reload themselves.
- `POST /user/api/re-sign-in` — `{ password, expectedUserId }`. Identity comes from `expectedUserId` (the anchored user.id), never the cookie *and* never the email; the cookie's current session row is deleted and a fresh session for the anchored user is issued (after verifying the password against that user's credential). See §Recovery for why id-keyed and not email-keyed.

### Signed-in actions
All go through `requireSignedIn(locals, body)`: `401` if no session, `400` if `expectedUserId` is missing, `409` if `session.user.id !== expectedUserId` (the §Action–identity binding). The client injects `expectedUserId = me.user.id` via the `meApi` wrapper.

**Session refresh on password re-confirmation.** The ops that re-verify the current password — `change-password-cred-start`, `delete-password-cred`, the password branch of `delete-google-cred`, and `disable-reset` — call `refreshSession(s.session.id)` immediately after `verifyPw` passes. Effect identical to a re-sign-in: `session.createdAt` resets to now, the freshness window re-opens, no cookie change. `delete-user` (password branch) skips the refresh — the session is being cascade-deleted anyway. The `409` mismatch and the `403` wrong-password throws both happen before `refreshSession`, so only the matched user with the correct password refreshes anything.

- `POST /user/api/change-password-cred-start` — `{ expectedUserId, currentPassword, newEmail, newPassword? }`. On email-only change returns an OTP shape; if a new password was supplied alongside an email change, the originator stashes it and forwards it in the OTP-proceed payload (not here).
- `POST /user/api/add-password-cred-start` — `{ expectedUserId, email }`. The chosen password rides in the OTP-proceed payload, not here.
- `POST /user/api/delete-password-cred` — `{ expectedUserId, password }`.
- `POST /user/api/delete-google-cred` — `{ expectedUserId, password? }`. Password-credential user includes `password`; Google-only user omits it (server falls back to session freshness).
- `POST /user/api/disable-reset` — `{ expectedUserId, password }`.
- `POST /user/api/enable-reset` — `{ expectedUserId }`. Gated on session freshness, not password (the recovery chain requires this).
- `POST /user/api/set-name` — `{ expectedUserId, name }` (`name=""` clears). Not sensitive but still identity-bound, so a cookie-swap can't silently rename someone else.
- `POST /user/api/delete-user` — `{ expectedUserId, password? }`. Same split as `delete-google-cred`.

### Google OAuth (popup-driven)
- `GET /user/api/google/start?intent={sign-in|link|re-sign-in}&callbackURL=/user/oauth-done[&uid={anchoredUserId}]` — opened via `window.open`. `uid` is sent for `re-sign-in` (carries the anchored user id into the signed `state`); for `link` the server reads it from the live session. Mints HMAC-signed `state = { n, cb, intent, uid }` and 302s to Google with `prompt=login`. Cookie matters for `link` (must match `state.uid` at callback) and `re-sign-in` (current session row replaced).
- `GET /user/api/google/callback?code=…&state=…` — not invoked by JS; the browser follows Google's redirect. Cookie use per intent: `sign-in` issues or creates a session; `link` requires a session matching `state.uid` and attaches the Google credential; `re-sign-in` deletes the cookie's current session row and issues a new one for `state.uid` (after verifying the freshly-authenticated Google account is linked to it).

