import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  startOtp,
  rotateOtp,
  cancelOtp,
  loadDestination,
  attemptOtp,
  consumeOtp,
  startResetFlow,
  consumeControllerToken,
  lookupControllerToken,
  hashPw,
  verifyPw,
  createSession,
  clearSession,
  revokeOtherSessions,
  deleteAllSessions,
  deleteSessionById,
  isSessionFresh,
  refreshSession,
  findUserByEmail,
  findUserById,
  findPasswordCred,
  findGoogleCred,
  findGithubCred,
  deleteGithubCred,
  revokeGoogleToken,
  revokeGithubGrant,
  listUserCreds,
  createUserWithPasswordCred,
  attachPasswordCred,
  changeUserEmail,
  setPasswordCredHash,
  deletePasswordCred,
  deleteGoogleCred,
  deleteUserCascade,
  setResetDisabled,
  setUserName,
} from "$lib/server/user-auth";

const MAX_NAME_LEN = 100;

type Body = Record<string, unknown>;

async function readBody(request: Request): Promise<Body> {
  try {
    return (await request.json()) as Body;
  } catch {
    return {};
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function requireSignedIn(locals: App.Locals, body: Body) {
  const s = locals.user;
  if (!s) error(401, "Not signed in");
  // Signed-in actions carry `expectedUserId` — the user the SPA is anchored to
  // and means to act on. If the ambient cookie has since been swapped to a
  // different user (another tab signed in as someone else; the cookie is
  // shared), refuse rather than silently retarget the operation at whoever
  // holds the cookie now. Mirrors the originUserId binding on OTP proceed
  // (consumeOtp) and state.uid on Google re-sign-in.
  const expectedUserId = str(body.expectedUserId);
  if (!expectedUserId) error(400, "expectedUserId required");
  if (s.user.id !== expectedUserId) error(409, "session belongs to a different user");
  return s;
}

const GET: RequestHandler = async ({ params, locals, url }) => {
  switch (params.op) {
    case "me": {
      const s = locals.user;
      if (!s) return json({ user: null });
      const creds = await listUserCreds(s.user.id);
      return json({
        user: {
          id: s.user.id,
          name: s.user.name,
          email: s.user.email,
          resetDisabled: s.user.resetDisabled,
        },
        credentials: creds.map((c) => ({
          providerId: c.providerId,
          accountId: c.accountId,
          // Password credentials have null credential.email — the email lives
          // on user.email. Surface it here so the client doesn't reach across
          // rows.
          email: c.providerId === "password" ? s.user.email : c.email,
        })),
        sessionFresh: isSessionFresh(s.session),
      });
    }
    case "otp-destination": {
      const vt = url.searchParams.get("vt");
      if (!vt) return json({ status: "invalid" });
      return json(await loadDestination(vt));
    }
    case "reset-destination": {
      const ct = url.searchParams.get("ct");
      if (!ct) return json({ status: "invalid" });
      const r = await lookupControllerToken(ct);
      if (!r) return json({ status: "invalid" });
      return json({ status: "loaded", email: r.row.email, type: r.row.type });
    }
  }
  error(404, "Unknown op");
};

const POST: RequestHandler = async (event) => {
  const { params, request, locals, url } = event;
  const body = await readBody(request);
  const origin = url.origin;

  switch (params.op) {
    // ── Unified sign-in / signup-shape ──────────────────────────────────────
    case "sign-in": {
      const email = str(body.email)?.toLowerCase();
      const password = str(body.password);
      if (!email || !password) error(400, "email and password required");

      const u = await findUserByEmail(email);
      const cred = u ? await findPasswordCred(u.id) : null;

      if (u && cred && cred.passwordHash) {
        const ok = await verifyPw(cred.passwordHash, password);
        if (ok) {
          await createSession(u.id, event);
          return json({ shape: "session" });
        }
      } else {
        // pad timing on a no-user branch
        await verifyPw(null, password);
      }

      // Sign-in miss → reverse-OTP type=signup (real if unregistered, synthetic if registered)
      const realPath = !u; // no user with this email → real signup path
      const r = await startOtp({ email, type: "signup", realPath, origin });
      return json({ shape: "signup-otp", ...r, email });
    }

    case "otp-rotate": {
      const at = str(body.actorToken);
      if (!at) error(400, "actorToken required");
      const r = await rotateOtp(at);
      return json(r);
    }
    case "otp-cancel": {
      const at = str(body.actorToken);
      if (!at) error(400, "actorToken required");
      await cancelOtp(at);
      return json({ ok: true });
    }
    case "otp-attempt": {
      // Used by the destination page: check the entered code against the verifier-token.
      const vt = str(body.verifierToken);
      const code = str(body.otp);
      if (!vt || !code) error(400, "verifierToken and otp required");
      const r = await attemptOtp(vt, code);
      return json(r);
    }

    case "otp-proceed": {
      const at = str(body.actorToken);
      if (!at) error(400, "actorToken required");
      // consumeOtp enforces the originUserId↔session binding for signed-in
      // flows; on mismatch it returns "fail" without consuming the row.
      const sessionUserId = locals.user?.user.id ?? null;
      const result = await consumeOtp(at, sessionUserId);
      if (result.kind === "too_frequent") {
        return json({ shape: "too_frequent", retryAfterMs: result.retryAfterMs });
      }
      if (result.kind === "expired") return json({ shape: "expired" });
      if (result.kind === "fail") return json({ shape: "fail" });

      const row = result.row;
      if (row.type === "signup") {
        const password = str(body.password);
        if (!password) error(400, "password required");
        const existing = await findUserByEmail(row.email);
        if (existing) error(409, "Email got registered while you were verifying");
        const hash = await hashPw(password);
        const id = await createUserWithPasswordCred({ email: row.email, passwordHash: hash });
        await createSession(id, event);
        return json({ shape: "session", newUser: true });
      }
      // change-email / add-password-cred: row.originUserId is guaranteed to
      // match the current session by consumeOtp.
      if (row.type === "change-email") {
        await changeUserEmail(row.originUserId!, row.email);
        const newPassword = str(body.password);
        if (newPassword) {
          await setPasswordCredHash(row.originUserId!, await hashPw(newPassword));
          await revokeOtherSessions(row.originUserId!, locals.user!.session.token);
        }
        return json({ shape: "ok" });
      }
      // add-password-cred
      const password = str(body.password);
      if (!password) error(400, "password required");
      const hash = await hashPw(password);
      await attachPasswordCred(row.originUserId!, row.email, hash);
      return json({ shape: "ok" });
    }

    // ── Reset password ──────────────────────────────────────────────────────
    case "reset-request": {
      const email = str(body.email);
      if (!email) error(400, "email required");
      await startResetFlow(email, origin);
      return json({ ok: true });
    }
    case "reset-submit": {
      const ct = str(body.controllerToken);
      const newPassword = str(body.newPassword);
      if (!ct || !newPassword) error(400, "controllerToken and newPassword required");
      const row = await consumeControllerToken(ct);
      if (!row) error(400, "invalid or expired");
      if (row.type !== "reset") error(400, "wrong token type");
      const u = await findUserByEmail(row.email);
      if (!u) error(400, "no such user");
      const hash = await hashPw(newPassword);
      await setPasswordCredHash(u.id, hash);
      await deleteAllSessions(u.id);
      return json({ ok: true });
    }

    // ── Sign-out ────────────────────────────────────────────────────────────
    case "sign-out": {
      // Anchor-bound, but with *local-only-on-mismatch* semantics (not the 409
      // refuse-pattern of the 8 guarded actions): the user clicked *out*, not
      // *re-enter*, so refusing would be the wrong UX. Instead we never delete
      // a session or clear a cookie that doesn't belong to the anchored user.
      //   - match: real sign-out (delete session row, clear cookie).
      //   - overwritten: cookie holds another user's live session — leave both
      //     the session and the cookie alone; the client just re-anchors
      //     locally. Their tabs keep working.
      //   - invalid: no live session, but the cookie token (if any) is orphan
      //     — clear it defensively. Nothing to delete in the DB.
      const expectedUserId = str(body.expectedUserId);
      if (!expectedUserId) error(400, "expectedUserId required");
      const s = locals.user;
      if (s && s.user.id !== expectedUserId) {
        // Overwritten — do nothing server-side.
        return json({ ok: true });
      }
      // Match (s.user.id === expectedUserId) or invalid (s === null).
      // clearSession deletes by cookie token (no-op if no matching row) and
      // clears the cookie — safe for both branches.
      await clearSession(event);
      return json({ ok: true });
    }

    // ── Signed-in credential management ─────────────────────────────────────
    case "change-password-cred-start": {
      const s = requireSignedIn(locals, body);
      const currentPassword = str(body.currentPassword);
      const newEmail = str(body.newEmail)?.toLowerCase();
      const newPassword = str(body.newPassword);
      if (!currentPassword || !newEmail) error(400, "currentPassword and newEmail required");
      const cred = await findPasswordCred(s.user.id);
      if (!cred) error(400, "no password credential to change");
      if (!(await verifyPw(cred.passwordHash, currentPassword))) error(403, "wrong password");
      // Password re-confirmed — refresh the session, same as a re-sign-in.
      await refreshSession(s.session.id);

      const emailChanged = newEmail !== s.user.email?.toLowerCase();
      if (!emailChanged && !newPassword) error(400, "no change requested");

      if (!emailChanged) {
        await setPasswordCredHash(s.user.id, await hashPw(newPassword!));
        await revokeOtherSessions(s.user.id, s.session.token);
        return json({ shape: "ok" });
      }

      const taken = await findUserByEmail(newEmail);
      const realPath = !taken;
      const r = await startOtp({
        email: newEmail,
        type: "change-email",
        realPath,
        origin,
        originUserId: s.user.id,
      });
      return json({ shape: "otp", ...r, email: newEmail });
    }

    case "re-sign-in": {
      // Re-sign-in is anchor-bound: the client carries `expectedUserId` (the
      // SPA's anchored user.id), and the server resigns in as *that* user —
      // not as "whoever currently owns some email." Emails can be re-allocated
      // (account deleted, re-registered at the same address with a new
      // user.id); an email-keyed re-sign-in would silently land on the new
      // owner, leaving the SPA's anchored identity unreachable. Mirrors the
      // Google `re-sign-in` intent, which keys on `state.uid`. The ambient
      // cookie is still never trusted to pick the user — it may be gone
      // ("invalid"), stale, or hold a different user ("overwritten").
      const password = str(body.password);
      const expectedUserId = str(body.expectedUserId);
      if (!password || !expectedUserId) error(400, "password and expectedUserId required");

      const u = await findUserById(expectedUserId);
      if (!u) {
        await verifyPw(null, password); // pad timing on a no-user branch
        error(403, "wrong password");
      }
      const cred = await findPasswordCred(u.id);
      if (!cred) {
        await verifyPw(null, password);
        error(403, "wrong password");
      }
      if (!(await verifyPw(cred.passwordHash, password))) error(403, "wrong password");

      // The cookie's current session (whoever owns it — a stale one of ours,
      // or another user's after a swap) is being replaced; delete it rather
      // than orphan it.
      if (locals.user) await deleteSessionById(locals.user.session.id);
      await createSession(u.id, event);
      return json({ ok: true });
    }

    case "add-password-cred-start": {
      const s = requireSignedIn(locals, body);
      const email = str(body.email)?.toLowerCase();
      if (!email) error(400, "email required");
      const existing = await findPasswordCred(s.user.id);
      if (existing) error(400, "user already has a password credential");
      const taken = await findUserByEmail(email);
      const realPath = !taken;
      const r = await startOtp({
        email,
        type: "add-password-cred",
        realPath,
        origin,
        originUserId: s.user.id,
      });
      return json({ shape: "otp", ...r, email });
    }

    case "delete-password-cred": {
      const s = requireSignedIn(locals, body);
      const password = str(body.password);
      if (!password) error(400, "password required");
      const cred = await findPasswordCred(s.user.id);
      if (!cred) error(400, "no password credential");
      if (!(await verifyPw(cred.passwordHash, password))) error(403, "wrong password");
      // Password re-confirmed — refresh the session, same as a re-sign-in.
      await refreshSession(s.session.id);
      const creds = await listUserCreds(s.user.id);
      if (creds.length <= 1) error(400, "must keep at least one credential");
      await deletePasswordCred(s.user.id);
      return json({ ok: true });
    }

    case "delete-google-cred": {
      const s = requireSignedIn(locals, body);
      const g = await findGoogleCred(s.user.id);
      if (!g) error(400, "no google credential");
      const creds = await listUserCreds(s.user.id);
      if (creds.length <= 1) error(400, "must keep at least one credential");
      // Gated like delete-user: a password-credential user re-enters the
      // password; a user without one (e.g. Google + another OAuth provider)
      // falls back to session freshness.
      const cred = await findPasswordCred(s.user.id);
      if (cred) {
        const password = str(body.password);
        if (!password) error(400, "password required");
        if (!(await verifyPw(cred.passwordHash, password))) error(403, "wrong password");
        // Password re-confirmed — refresh the session, same as a re-sign-in.
        await refreshSession(s.session.id);
      } else {
        if (!isSessionFresh(s.session)) error(403, "session not fresh; sign in again");
      }
      await revokeGoogleToken(g.accessToken);
      await deleteGoogleCred(s.user.id);
      return json({ ok: true });
    }

    case "delete-github-cred": {
      const s = requireSignedIn(locals, body);
      const g = await findGithubCred(s.user.id);
      if (!g) error(400, "no github credential");
      const creds = await listUserCreds(s.user.id);
      if (creds.length <= 1) error(400, "must keep at least one credential");
      const cred = await findPasswordCred(s.user.id);
      if (cred) {
        const password = str(body.password);
        if (!password) error(400, "password required");
        if (!(await verifyPw(cred.passwordHash, password))) error(403, "wrong password");
        await refreshSession(s.session.id);
      } else {
        if (!isSessionFresh(s.session)) error(403, "session not fresh; sign in again");
      }
      await revokeGithubGrant(g.accessToken);
      await deleteGithubCred(s.user.id);
      return json({ ok: true });
    }

    case "disable-reset": {
      const s = requireSignedIn(locals, body);
      const password = str(body.password);
      if (!password) error(400, "password required");
      const cred = await findPasswordCred(s.user.id);
      if (!cred) error(400, "no password credential");
      if (!(await verifyPw(cred.passwordHash, password))) error(403, "wrong password");
      // Password re-confirmed — refresh the session, same as a re-sign-in.
      await refreshSession(s.session.id);
      await setResetDisabled(s.user.id, true);
      return json({ ok: true });
    }

    case "enable-reset": {
      // Not password-gated — the recovery chain (Google sign-in → re-enable →
      // reset) requires this for users who've lost their password. Freshness
      // stands in for the password check: a fresh session proves a recent auth
      // (either password or Google prompt=login), without blocking recovery.
      const s = requireSignedIn(locals, body);
      const cred = await findPasswordCred(s.user.id);
      if (!cred) error(400, "no password credential");
      if (!isSessionFresh(s.session)) error(403, "session not fresh; sign in again to continue");
      await setResetDisabled(s.user.id, false);
      return json({ ok: true });
    }

    case "set-name": {
      // Optional user-chosen label. Not sensitive — no password/freshness gate.
      // An empty or whitespace-only value clears the name back to null.
      const s = requireSignedIn(locals, body);
      const raw = typeof body.name === "string" ? body.name.trim() : "";
      if (raw.length > MAX_NAME_LEN) error(400, `name must be ${MAX_NAME_LEN} characters or fewer`);
      await setUserName(s.user.id, raw.length > 0 ? raw : null);
      return json({ ok: true });
    }

    case "delete-user": {
      const s = requireSignedIn(locals, body);
      const cred = await findPasswordCred(s.user.id);
      if (cred) {
        const password = str(body.password);
        if (!password) error(400, "password required");
        if (!(await verifyPw(cred.passwordHash, password))) error(403, "wrong password");
      } else {
        if (!isSessionFresh(s.session)) error(403, "session not fresh; sign in again");
      }
      const googleCred = await findGoogleCred(s.user.id);
      const githubCred = await findGithubCred(s.user.id);
      await Promise.all([
        revokeGoogleToken(googleCred?.accessToken ?? null),
        revokeGithubGrant(githubCred?.accessToken ?? null),
      ]);
      await deleteUserCascade(s.user.id);
      await clearSession(event);
      return json({ ok: true });
    }
  }
  error(404, "Unknown op");
};

export { GET, POST };
