import { redirect, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import {
  attachGithubCred,
  createSession,
  createUserWithGithubCred,
  deleteSessionById,
  findGithubCredByAccountId,
  verifyState,
} from "$lib/server/user-auth";

type GithubTokenResp = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};
type GithubUser = {
  id: number;
  login: string;
  email: string | null;
  name: string | null;
};
type GithubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
};

export const GET: RequestHandler = async (event) => {
  const { url, locals } = event;
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  if (!code || !stateRaw) error(400, "missing code or state");
  const state = verifyState<{ cb: string; intent: "sign-in" | "link" | "re-sign-in"; uid: string | null }>(stateRaw);
  if (!state) error(400, "invalid state");

  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) error(500, "GitHub OAuth not configured");
  const redirectUri = `${url.origin}/auth/api/github/callback`;

  // Exchange code for access token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) error(502, `github token exchange failed: ${tokenRes.status}`);
  const tokens = (await tokenRes.json()) as GithubTokenResp;
  if (tokens.error || !tokens.access_token) {
    error(502, `github token error: ${tokens.error_description ?? tokens.error ?? "unknown"}`);
  }

  // Fetch user profile
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      accept: "application/vnd.github+json",
    },
  });
  if (!userRes.ok) error(502, "github user fetch failed");
  const ghUser = (await userRes.json()) as GithubUser;
  if (!ghUser.id) error(502, "no GitHub user id");

  // GitHub may not expose email on the user endpoint if it's private — fall
  // back to the emails endpoint to get the primary verified address.
  let email = ghUser.email;
  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: "application/vnd.github+json",
      },
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as GithubEmail[];
      const primary = emails.find((e) => e.primary && e.verified);
      email = primary?.email ?? null;
    }
  }

  const accountId = String(ghUser.id);

  if (state.intent === "re-sign-in") {
    if (!state.uid) redirect(302, `${state.cb}?error=resign-no-uid`);
    const matched = await findGithubCredByAccountId(accountId);
    if (!matched || matched.userId !== state.uid) {
      redirect(302, `${state.cb}?error=resign-user-mismatch`);
    }
    if (locals.user) await deleteSessionById(locals.user.session.id);
    await createSession(matched.userId, event);
    redirect(302, state.cb);
  }

  if (state.intent === "link") {
    if (!locals.user || locals.user.user.id !== state.uid) {
      redirect(302, `${state.cb}?error=link-session-mismatch`);
    }
    const existing = await findGithubCredByAccountId(accountId);
    if (existing && existing.userId !== locals.user.user.id) {
      redirect(302, `${state.cb}?error=github-already-linked`);
    }
    if (!existing) {
      await attachGithubCred({
        userId: locals.user.user.id,
        accountId,
        email,
        accessToken: tokens.access_token,
      });
    }
    redirect(302, state.cb);
  }

  // intent = sign-in
  const existing = await findGithubCredByAccountId(accountId);
  let userId: string;
  let newUser = false;
  if (existing) {
    userId = existing.userId;
  } else {
    userId = await createUserWithGithubCred({
      accountId,
      email,
      accessToken: tokens.access_token,
    });
    newUser = true;
  }
  await createSession(userId, event);
  redirect(302, newUser ? `${state.cb}?new=1` : state.cb);
};
