import { randomBytes, randomInt, timingSafeEqual, createHmac } from "node:crypto";
import type { RequestEvent } from "@sveltejs/kit";
import { eq, and, sql } from "drizzle-orm";
import { db } from "./db";
import { user, credential, session, otpVerification, ctrlVerification } from "./db/auth-schema";
import { env } from "$env/dynamic/private";
import { sendMail, renderEmail } from "./mailer";

// ── Constants ────────────────────────────────────────────────────────────────
export const SESSION_COOKIE = "user-demo.session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
export const OTP_TTL_MS = 1000 * 60 * 10;
export const CONTROLLER_TTL_MS = 1000 * 60 * 30;
export const OTP_MAX_ATTEMPTS = 5;
export const DAILY_SEND_CAP = 20;
export const FRESH_SESSION_MS = 1000 * 60 * 1;

// ── ID & token generation ────────────────────────────────────────────────────
const id = (n = 16) => randomBytes(n).toString("hex");
export const newUserId = () => `u_${id(12)}`;
export const newCredentialId = () => `c_${id(12)}`;
export const newSessionId = () => `s_${id(12)}`;
export const newOtpRowId = () => `ov_${id(12)}`;
export const newCtrlRowId = () => `ct_${id(12)}`;

export const newActorToken = () => `at_${id(20)}`;
export const newVerifierToken = () => `vt_${id(24)}`;
export const newControllerToken = () => `ct_${id(24)}`;
export const newOtp = () => String(randomInt(0, 10000)).padStart(4, "0");

const SECRET = env.AUTH_SECRET || "dev-only-fallback-secret";
function safeEq(a: string, b: string) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ── Password hashing ─────────────────────────────────────────────────────────
// argon2id via Bun.password; the stored string is self-describing.
export async function hashPw(pw: string) {
  return Bun.password.hash(pw.normalize("NFKC"));
}
export async function verifyPw(stored: string | null, pw: string) {
  // Always do one hash so "no credential" and "wrong password" cost the same.
  if (!stored) {
    await Bun.password.hash(pw.normalize("NFKC"));
    return false;
  }
  try {
    return await Bun.password.verify(pw.normalize("NFKC"), stored);
  } catch {
    // Unknown/legacy hash format → treat as wrong password rather than 500.
    return false;
  }
}

// ── Session management ───────────────────────────────────────────────────────
export async function createSession(userId: string, event: RequestEvent) {
  const token = `s_${randomBytes(24).toString("hex")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(session).values({
    id: newSessionId(),
    token,
    userId,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    ipAddress: event.getClientAddress(),
    userAgent: event.request.headers.get("user-agent") ?? null,
  });
  event.cookies.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    expires: expiresAt,
  });
  return { token, expiresAt };
}

export async function getSession(event: RequestEvent) {
  const token = event.cookies.get(SESSION_COOKIE);
  if (!token) return null;
  const rows = await db.select().from(session).where(eq(session.token, token)).limit(1);
  const s = rows[0];
  if (!s) return null;
  if (s.expiresAt.getTime() < Date.now()) {
    await db.delete(session).where(eq(session.id, s.id));
    return null;
  }
  const u = (await db.select().from(user).where(eq(user.id, s.userId)).limit(1))[0];
  if (!u) return null;
  return { user: u, session: s };
}

export async function clearSession(event: RequestEvent) {
  const token = event.cookies.get(SESSION_COOKIE);
  if (token) await db.delete(session).where(eq(session.token, token));
  event.cookies.delete(SESSION_COOKIE, { path: "/" });
}

export async function revokeOtherSessions(userId: string, keepToken: string) {
  const rows = await db.select().from(session).where(eq(session.userId, userId));
  for (const s of rows) {
    if (s.token !== keepToken) await db.delete(session).where(eq(session.id, s.id));
  }
}

export async function deleteAllSessions(userId: string) {
  await db.delete(session).where(eq(session.userId, userId));
}

// Delete one session row by id — used when re-sign-in replaces the cookie's
// current session (the same user's old row, or another user's in a swap).
export async function deleteSessionById(sessionId: string) {
  await db.delete(session).where(eq(session.id, sessionId));
}

export function isSessionFresh(s: { createdAt: Date }) {
  return Date.now() - s.createdAt.getTime() < FRESH_SESSION_MS;
}

// Resets a session's freshness clock. Called after an in-session password
// re-confirmation: re-entering the password is itself a fresh authentication,
// so the session should become fresh again — same effect as a re-sign-in,
// without rotating the token or touching the cookie.
export async function refreshSession(sessionId: string) {
  const now = new Date();
  await db.update(session).set({ createdAt: now, updatedAt: now }).where(eq(session.id, sessionId));
}

// ── Daily-send counter (in-memory; not durable — see auth-flows.md §rate-limit) ─
type DailyEntry = { day: string; count: number; capNoticeSent: boolean };
const daily = new Map<string, DailyEntry>();
function today() {
  return new Date().toISOString().slice(0, 10);
}
function getDaily(email: string): DailyEntry {
  const k = email.toLowerCase();
  const d = today();
  let e = daily.get(k);
  if (!e || e.day !== d) {
    e = { day: d, count: 0, capNoticeSent: false };
    daily.set(k, e);
  }
  return e;
}
export function dailyState(email: string) {
  const e = getDaily(email);
  return { count: e.count, capReached: e.count >= DAILY_SEND_CAP, capNoticeSent: e.capNoticeSent };
}
export function bumpDaily(email: string) {
  const e = getDaily(email);
  e.count += 1;
  return e.count;
}
// Refund a previously-bumped slot when the underlying send fails. Bump-then-
// refund (rather than send-then-bump) keeps the cap check tight under
// concurrent requests — the window where two callers can both pass the cap
// check stays narrow.
export function decrementDaily(email: string) {
  const e = getDaily(email);
  if (e.count > 0) e.count -= 1;
  return e.count;
}
export function markCapNoticeSent(email: string) {
  getDaily(email).capNoticeSent = true;
}

// ── Reverse-OTP types ────────────────────────────────────────────────────────
export type OtpType = "signup" | "change-email" | "add-password-cred";
export type OtpRow = typeof otpVerification.$inferSelect;

export type OtpAction = "proceed" | "rotate";
export const ACTION_COOLDOWN_MS: Record<OtpAction, number> = {
  proceed: 5_000,
  rotate: 30_000,
};

// Universal action rate-limit, keyed by `${action}:${actorToken}` (real OR synthetic).
const actionCooldown = new Map<string, number>();

function checkActionCooldown(
  action: OtpAction,
  actorToken: string,
): { ok: true } | { ok: false; retryAfterMs: number } {
  const key = `${action}:${actorToken}`;
  const now = Date.now();
  const next = actionCooldown.get(key);
  if (next === undefined) return { ok: true };
  if (next > now) return { ok: false, retryAfterMs: next - now };
  actionCooldown.delete(key);
  return { ok: true };
}

function setActionCooldown(action: OtpAction, actorToken: string) {
  actionCooldown.set(`${action}:${actorToken}`, Date.now() + ACTION_COOLDOWN_MS[action]);
}

// ── Email senders ────────────────────────────────────────────────────────────
async function sendOtpEmail(email: string, type: OtpType, verifierToken: string, origin: string) {
  const url = `${origin}/auth/otp?vt=${verifierToken}`;
  const subject =
    type === "signup"
      ? "Confirm your sign-up"
      : type === "change-email"
        ? "Confirm your new email"
        : "Confirm linking this email";
  const body =
    type === "signup"
      ? "Tap the button below, then enter the 4-digit code shown in your browser."
      : type === "change-email"
        ? "Tap the button below to confirm this is your new email address, then enter the 4-digit code shown in your browser."
        : "Tap the button below to link this email to your account, then enter the 4-digit code shown in your browser.";
  const { html, text } = renderEmail({
    heading: subject,
    body,
    ctaText: "Confirm",
    url,
    footer: "If you didn't request this, you can ignore this email.",
  });
  await sendMail({ to: email, subject, html, text });
}

async function sendCapNoticeSignup(email: string, ctrl: string, origin: string) {
  const subject = "Final email today — complete your sign-up";
  const url = `${origin}/auth/otp/final?ct=${ctrl}`;
  const body =
    "Too many sign-up attempts have been made for this address today. This link is the only way to complete sign-up today.";
  const { html, text } = renderEmail({
    heading: subject,
    body,
    ctaText: "Complete sign-up",
    url,
    footer: "If you didn't request this, you can ignore this email.",
  });
  await sendMail({ to: email, subject, html, text });
}

async function sendResetEmail(email: string, ctrl: string, origin: string) {
  const subject = "Reset your password";
  const url = `${origin}/auth/reset?ct=${ctrl}`;
  const body = "Tap the button below to reset your password. The link is valid for 30 minutes.";
  const { html, text } = renderEmail({
    heading: subject,
    body,
    ctaText: "Reset password",
    url,
    footer: "If you didn't request this, you can ignore this email.",
  });
  await sendMail({ to: email, subject, html, text });
}

// ── Reverse-OTP API ──────────────────────────────────────────────────────────
export type OtpStartResult = { actorToken: string; otp: string };

/**
 * Either creates a real otpVerification row or returns a synthetic actor-token + otp.
 * `realPath` decides which. For ignored cases (e.g. signup against an existing email)
 * pass realPath=false.
 */
export async function startOtp(opts: {
  email: string;
  type: OtpType;
  realPath: boolean;
  origin: string;
  originUserId?: string;
}): Promise<OtpStartResult> {
  const actorToken = newActorToken();
  const otp = newOtp();

  if (!opts.realPath) {
    // synthetic: no row, no email
    return { actorToken, otp };
  }

  const state = dailyState(opts.email);
  if (state.capReached) {
    // (N+1)th request → switch to a final controller-token email if not yet sent today.
    if (!state.capNoticeSent) {
      const ctrl = await mintControllerToken({
        email: opts.email,
        // sign-up-shape flows all use a `signup` controller-token for the cap-notice.
        type: "signup",
        originUserId: opts.originUserId,
      });
      await sendCapNoticeSignup(opts.email, ctrl.token, opts.origin);
      markCapNoticeSent(opts.email);
    }
    // synthetic from here — no row, no email
    return { actorToken, otp };
  }

  const verifierToken = newVerifierToken();
  const now = new Date();
  await db.insert(otpVerification).values({
    id: newOtpRowId(),
    actorToken,
    verifierToken,
    otp,
    attempts: 0,
    verified: false,
    type: opts.type,
    email: opts.email.toLowerCase(),
    originUserId: opts.originUserId ?? null,
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    createdAt: now,
    updatedAt: now,
  });
  bumpDaily(opts.email);
  try {
    await sendOtpEmail(opts.email, opts.type, verifierToken, opts.origin);
  } catch (err) {
    decrementDaily(opts.email);
    throw err;
  }
  return { actorToken, otp };
}

async function readVerifByActor(actorToken: string) {
  const rows = await db
    .select()
    .from(otpVerification)
    .where(eq(otpVerification.actorToken, actorToken))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { row: r, expired: r.expiresAt.getTime() < Date.now() };
}

async function readVerifByVerifier(verifierToken: string) {
  const rows = await db
    .select()
    .from(otpVerification)
    .where(eq(otpVerification.verifierToken, verifierToken))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { row: r, expired: r.expiresAt.getTime() < Date.now() };
}

export type RotateResult =
  | { kind: "ok"; otp: string }
  | { kind: "verified" }
  | { kind: "expired" }
  | { kind: "too_frequent"; retryAfterMs: number };

/**
 * Rotate the OTP. State matrix per auth-flows.md §reverse-OTP-vs-classic:
 *   no row | unverified+expired → ok with fresh UI-only OTP, no server change
 *   verified+fresh              → "verified" — already done, originator should Proceed
 *   verified+expired            → "expired" terminal, delete row
 *   unverified+fresh (real)     → rotate code, reset attempts; link stable
 */
export async function rotateOtp(actorToken: string): Promise<RotateResult> {
  const cd = checkActionCooldown("rotate", actorToken);
  if (!cd.ok) return { kind: "too_frequent", retryAfterMs: cd.retryAfterMs };
  setActionCooldown("rotate", actorToken);

  const otp = newOtp();
  const found = await readVerifByActor(actorToken);
  if (!found || (found.expired && !found.row.verified)) return { kind: "ok", otp };
  if (found.row.verified && found.expired) {
    await db.delete(otpVerification).where(eq(otpVerification.id, found.row.id));
    return { kind: "expired" };
  }
  if (found.row.verified) return { kind: "verified" };
  await db
    .update(otpVerification)
    .set({ otp, attempts: 0, updatedAt: new Date() })
    .where(eq(otpVerification.id, found.row.id));
  return { kind: "ok", otp };
}

export async function cancelOtp(actorToken: string) {
  await db.delete(otpVerification).where(eq(otpVerification.actorToken, actorToken));
}

export type OtpDestState =
  | { status: "loaded"; email: string; attemptsLeft: number }
  | { status: "invalid" }
  | { status: "verified"; email: string };

export async function loadDestination(verifierToken: string): Promise<OtpDestState> {
  const found = await readVerifByVerifier(verifierToken);
  if (!found || found.expired) return { status: "invalid" };
  if (found.row.verified) return { status: "verified", email: found.row.email };
  return {
    status: "loaded",
    email: found.row.email,
    attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - found.row.attempts),
  };
}

export type OtpAttemptResult =
  | { ok: true }
  | { ok: false; error: "WRONG_CODE"; attemptsLeft: number }
  | { ok: false; error: "INVALID_OR_EXPIRED" }
  | { ok: false; error: "TOO_MANY_ATTEMPTS" };

export async function attemptOtp(verifierToken: string, code: string): Promise<OtpAttemptResult> {
  const found = await readVerifByVerifier(verifierToken);
  if (!found || found.expired) return { ok: false, error: "INVALID_OR_EXPIRED" };
  const r = found.row;
  if (r.verified) return { ok: true };
  if (r.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };

  if (!safeEq(r.otp, code)) {
    // Atomic increment — RETURNING the post-image keeps the brute-force bound
    // tight under concurrent attempts.
    const [updated] = await db
      .update(otpVerification)
      .set({ attempts: sql`${otpVerification.attempts} + 1`, updatedAt: new Date() })
      .where(eq(otpVerification.id, r.id))
      .returning({ attempts: otpVerification.attempts });
    if (updated.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };
    return { ok: false, error: "WRONG_CODE", attemptsLeft: OTP_MAX_ATTEMPTS - updated.attempts };
  }

  await db
    .update(otpVerification)
    .set({ verified: true, updatedAt: new Date() })
    .where(eq(otpVerification.id, r.id));
  return { ok: true };
}

export type ConsumeResult =
  | { kind: "ok"; row: OtpRow }
  | { kind: "expired" }
  | { kind: "fail" }
  | { kind: "too_frequent"; retryAfterMs: number };

/**
 * Any failed proceed leaves the row alive — it ages out via TTL like any
 * unvisited verification. The row is consumed only on success or on the
 * verified-but-expired terminal.
 *
 * `sessionUserId` is the currently signed-in user's id (or null). When the
 * row carries `originUserId` (signed-in flows: change-email, add-credential),
 * a session mismatch returns fail without consuming.
 */
export async function consumeOtp(
  actorToken: string,
  sessionUserId: string | null,
): Promise<ConsumeResult> {
  const cd = checkActionCooldown("proceed", actorToken);
  if (!cd.ok) return { kind: "too_frequent", retryAfterMs: cd.retryAfterMs };
  setActionCooldown("proceed", actorToken);

  const found = await readVerifByActor(actorToken);
  if (!found) return { kind: "fail" };

  if (found.row.verified && found.expired) {
    await db.delete(otpVerification).where(eq(otpVerification.id, found.row.id));
    return { kind: "expired" };
  }

  if (!found.row.verified || found.expired) return { kind: "fail" };

  if (found.row.originUserId !== null && found.row.originUserId !== sessionUserId) {
    return { kind: "fail" };
  }

  await db.delete(otpVerification).where(eq(otpVerification.id, found.row.id));
  return { kind: "ok", row: found.row };
}

// ── Controller-token store ───────────────────────────────────────────────────
export type CtrlType = "reset" | "signup";
export type CtrlRow = typeof ctrlVerification.$inferSelect;

export async function mintControllerToken(opts: {
  email: string;
  type: CtrlType;
  originUserId?: string;
}) {
  const token = newControllerToken();
  const now = new Date();
  await db.insert(ctrlVerification).values({
    id: newCtrlRowId(),
    token,
    type: opts.type,
    email: opts.email.toLowerCase(),
    originUserId: opts.originUserId ?? null,
    expiresAt: new Date(now.getTime() + CONTROLLER_TTL_MS),
    createdAt: now,
    updatedAt: now,
  });
  return { token };
}

export async function lookupControllerToken(token: string) {
  const rows = await db
    .select()
    .from(ctrlVerification)
    .where(eq(ctrlVerification.token, token))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  if (r.expiresAt.getTime() < Date.now()) {
    await db.delete(ctrlVerification).where(eq(ctrlVerification.id, r.id));
    return null;
  }
  return { row: r };
}

export async function consumeControllerToken(token: string) {
  const found = await lookupControllerToken(token);
  if (!found) return null;
  await db.delete(ctrlVerification).where(eq(ctrlVerification.id, found.row.id));
  return found.row;
}

export async function startResetFlow(email: string, origin: string): Promise<void> {
  // Synthetic conditions:
  // - email unregistered
  // - resetDisabled on the user
  // - daily cap reached (a final cap-notice email is sent if not already today)
  const eml = email.toLowerCase();
  const u = (await db.select().from(user).where(eq(user.email, eml)).limit(1))[0];
  if (!u) return;
  if (u.resetDisabled) return;
  // require a password credential (Google-only users have no password to reset)
  const cred = await findPasswordCred(u.id);
  if (!cred) return;

  const state = dailyState(eml);
  if (state.capReached) {
    if (!state.capNoticeSent) {
      const ctrl = await mintControllerToken({ email: eml, type: "reset" });
      await sendCapNoticeSignup(eml, ctrl.token, origin);
      markCapNoticeSent(eml);
    }
    return;
  }
  const ctrl = await mintControllerToken({ email: eml, type: "reset" });
  bumpDaily(eml);
  try {
    await sendResetEmail(eml, ctrl.token, origin);
  } catch (err) {
    decrementDaily(eml);
    throw err;
  }
}

// ── User & credential helpers ────────────────────────────────────────────────
export async function findUserByEmail(email: string) {
  const eml = email.toLowerCase();
  return (await db.select().from(user).where(eq(user.email, eml)).limit(1))[0] ?? null;
}

export async function findUserById(userId: string) {
  return (await db.select().from(user).where(eq(user.id, userId)).limit(1))[0] ?? null;
}

export async function findPasswordCred(userId: string) {
  return (
    (
      await db
        .select()
        .from(credential)
        .where(and(eq(credential.userId, userId), eq(credential.providerId, "password")))
        .limit(1)
    )[0] ?? null
  );
}

export async function findGoogleCred(userId: string) {
  return (
    (
      await db
        .select()
        .from(credential)
        .where(and(eq(credential.userId, userId), eq(credential.providerId, "google")))
        .limit(1)
    )[0] ?? null
  );
}

export async function listUserCreds(userId: string) {
  return await db.select().from(credential).where(eq(credential.userId, userId));
}

export async function createUserWithPasswordCred(opts: {
  email: string;
  passwordHash: string;
}) {
  const uid = newUserId();
  const eml = opts.email.toLowerCase();
  const now = new Date();
  await db.insert(user).values({
    id: uid,
    name: null,
    email: eml,
    resetDisabled: false,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(credential).values({
    id: newCredentialId(),
    providerId: "password",
    userId: uid,
    passwordHash: opts.passwordHash,
    createdAt: now,
    updatedAt: now,
  });
  return uid;
}

export async function attachPasswordCred(userId: string, email: string, passwordHash: string) {
  const eml = email.toLowerCase();
  const now = new Date();
  await db.insert(credential).values({
    id: newCredentialId(),
    providerId: "password",
    userId,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  });
  await db.update(user).set({ email: eml, updatedAt: new Date() }).where(eq(user.id, userId));
}

export async function changeUserEmail(userId: string, newEmail: string) {
  const eml = newEmail.toLowerCase();
  await db.update(user).set({ email: eml, updatedAt: new Date() }).where(eq(user.id, userId));
}

export async function setPasswordCredHash(userId: string, passwordHash: string) {
  await db
    .update(credential)
    .set({ passwordHash, updatedAt: new Date() })
    .where(and(eq(credential.userId, userId), eq(credential.providerId, "password")));
}

export async function deletePasswordCred(userId: string) {
  await db
    .delete(credential)
    .where(and(eq(credential.userId, userId), eq(credential.providerId, "password")));
  // Clear correspondent email and reset the resetDisabled flag — it's only
  // meaningful while a password credential exists.
  await db
    .update(user)
    .set({ email: null, resetDisabled: false, updatedAt: new Date() })
    .where(eq(user.id, userId));
}

export async function deleteGoogleCred(userId: string) {
  await db
    .delete(credential)
    .where(and(eq(credential.userId, userId), eq(credential.providerId, "google")));
}

export async function setUserName(userId: string, name: string | null) {
  await db
    .update(user)
    .set({ name, updatedAt: new Date() })
    .where(eq(user.id, userId));
}

export async function setResetDisabled(userId: string, disabled: boolean) {
  await db
    .update(user)
    .set({ resetDisabled: disabled, updatedAt: new Date() })
    .where(eq(user.id, userId));
}

export async function deleteUserCascade(userId: string) {
  // session/credential/otpVerification/ctrlVerification all cascade via FK on user.id
  await db.delete(user).where(eq(user.id, userId));
}

// ── OAuth state helpers (HMAC-signed, no DB) ─────────────────────────────────
export function signState(payload: object) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyState<T = unknown>(s: string): T | null {
  const [body, sig] = s.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(body).digest("base64url");
  if (!safeEq(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function findGithubCred(userId: string) {
  return (
    (
      await db
        .select()
        .from(credential)
        .where(and(eq(credential.userId, userId), eq(credential.providerId, "github")))
        .limit(1)
    )[0] ?? null
  );
}

export async function deleteGithubCred(userId: string) {
  await db
    .delete(credential)
    .where(and(eq(credential.userId, userId), eq(credential.providerId, "github")));
}

export async function findGithubCredByAccountId(accountId: string) {
  return (
    (
      await db
        .select()
        .from(credential)
        .where(
          and(
            eq(credential.providerId, "github"),
            eq(credential.accountId, accountId),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}

export async function createUserWithGithubCred(opts: {
  accountId: string;
  email: string | null;
  accessToken?: string | null;
}) {
  const uid = newUserId();
  const now = new Date();
  await db.insert(user).values({
    id: uid,
    name: null,
    email: null,
    resetDisabled: false,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(credential).values({
    id: newCredentialId(),
    accountId: opts.accountId,
    providerId: "github",
    userId: uid,
    email: opts.email?.toLowerCase() ?? null,
    accessToken: opts.accessToken ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return uid;
}

export async function attachGithubCred(opts: {
  userId: string;
  accountId: string;
  email: string | null;
  accessToken?: string | null;
}) {
  const now = new Date();
  await db.insert(credential).values({
    id: newCredentialId(),
    accountId: opts.accountId,
    providerId: "github",
    userId: opts.userId,
    email: opts.email?.toLowerCase() ?? null,
    accessToken: opts.accessToken ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function findGoogleCredByAccountId(accountId: string) {
  return (
    (
      await db
        .select()
        .from(credential)
        .where(
          and(
            eq(credential.providerId, "google"),
            eq(credential.accountId, accountId),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}

export async function createUserWithGoogleCred(opts: {
  accountId: string;
  email: string | null; // OAuth claim — stored on credential.email; NOT copied to user.email
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
}) {
  const uid = newUserId();
  const now = new Date();
  await db.insert(user).values({
    id: uid,
    // OAuth name claim deliberately NOT promoted to user.name, same as email.
    name: null,
    email: null,
    resetDisabled: false,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(credential).values({
    id: newCredentialId(),
    accountId: opts.accountId,
    providerId: "google",
    userId: uid,
    email: opts.email?.toLowerCase() ?? null,
    accessToken: opts.accessToken ?? null,
    refreshToken: opts.refreshToken ?? null,
    idToken: opts.idToken ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return uid;
}

// Best-effort — never throws; called before credential/user deletion so the
// provider removes the app authorization and the next OAuth link shows a fresh
// consent screen instead of silent re-authorization.
export async function revokeGoogleToken(accessToken: string | null) {
  if (!accessToken) return;
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
    });
  } catch {}
}

export async function revokeGithubGrant(accessToken: string | null) {
  if (!accessToken) return;
  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return;
  try {
    await fetch(`https://api.github.com/applications/${clientId}/grant`, {
      method: "DELETE",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ access_token: accessToken }),
    });
  } catch {}
}

export async function attachGoogleCred(opts: {
  userId: string;
  accountId: string;
  email: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
}) {
  const now = new Date();
  await db.insert(credential).values({
    id: newCredentialId(),
    accountId: opts.accountId,
    providerId: "google",
    userId: opts.userId,
    email: opts.email?.toLowerCase() ?? null,
    accessToken: opts.accessToken ?? null,
    refreshToken: opts.refreshToken ?? null,
    idToken: opts.idToken ?? null,
    createdAt: now,
    updatedAt: now,
  });
}
