import { redirect, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import {
  attachGoogleCred,
  createSession,
  createUserWithGoogleCred,
  deleteSessionById,
  findGoogleCredByAccountId,
  verifyState,
} from "$lib/server/user-auth";

type GoogleTokenResp = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
};
type GoogleUserInfo = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export const GET: RequestHandler = async (event) => {
  const { url, locals } = event;
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  if (!code || !stateRaw) error(400, "missing code or state");
  const state = verifyState<{ cb: string; intent: "sign-in" | "link" | "re-sign-in"; uid: string | null }>(stateRaw);
  if (!state) error(400, "invalid state");

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) error(500, "Google OAuth not configured");
  const redirectUri = `${url.origin}/auth/api/google/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) error(502, `google token exchange failed: ${tokenRes.status}`);
  const tokens = (await tokenRes.json()) as GoogleTokenResp;

  // Fetch userinfo (we don't trust the id_token JWS without verifying — userinfo over TLS is enough for the demo)
  const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) error(502, "google userinfo failed");
  const info = (await userRes.json()) as GoogleUserInfo;
  if (!info.sub) error(502, "no Google subject");

  if (state.intent === "re-sign-in") {
    // The client carried the user it wants to re-sign-in as (state.uid). The
    // ambient cookie is not trusted to pick the user — it may be gone, or hold
    // a different user (a swap). The proof is a fresh Google auth
    // (prompt=login) whose account is actually linked to that user.
    if (!state.uid) redirect(302, `${state.cb}?error=resign-no-uid`);
    const matched = await findGoogleCredByAccountId(info.sub);
    if (!matched || matched.userId !== state.uid) {
      redirect(302, `${state.cb}?error=resign-user-mismatch`);
    }
    // The cookie's current session (a stale one of ours, or another user's
    // after a swap) is being replaced — delete it rather than orphan it.
    if (locals.user) await deleteSessionById(locals.user.session.id);
    await createSession(matched.userId, event);
    redirect(302, state.cb);
  }

  if (state.intent === "link") {
    if (!locals.user || locals.user.user.id !== state.uid) {
      // signed-in user mismatch — bounce home with an error
      redirect(302, `${state.cb}?error=link-session-mismatch`);
    }
    // Refuse to attach if this Google account is already attached to another user.
    const existing = await findGoogleCredByAccountId(info.sub);
    if (existing && existing.userId !== locals.user.user.id) {
      redirect(302, `${state.cb}?error=google-already-linked`);
    }
    if (!existing) {
      await attachGoogleCred({
        userId: locals.user.user.id,
        accountId: info.sub,
        email: info.email ?? null,
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
        idToken: tokens.id_token ?? null,
      });
    }
    redirect(302, state.cb);
  }

  // intent = sign-in
  const existing = await findGoogleCredByAccountId(info.sub);
  let userId: string;
  let newUser = false;
  if (existing) {
    userId = existing.userId;
    // (could refresh OAuth tokens here; skipped for the demo)
  } else {
    userId = await createUserWithGoogleCred({
      accountId: info.sub,
      email: info.email ?? null,
      accessToken: tokens.access_token ?? null,
      refreshToken: tokens.refresh_token ?? null,
      idToken: tokens.id_token ?? null,
    });
    newUser = true;
  }
  await createSession(userId, event);
  redirect(302, newUser ? `${state.cb}?new=1` : state.cb);
};
