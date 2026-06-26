import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import { signState } from "$lib/server/user-auth";

const SCOPE = "read:user user:email";

export const GET: RequestHandler = async ({ url, locals }) => {
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) error(500, "GITHUB_CLIENT_ID not configured");
  const rawIntent = url.searchParams.get("intent");
  const intent: "sign-in" | "link" | "re-sign-in" =
    rawIntent === "link" ? "link" : rawIntent === "re-sign-in" ? "re-sign-in" : "sign-in";
  const callbackURL = url.searchParams.get("callbackURL") ?? "/auth/oauth-done";

  const state = signState({
    n: Math.random().toString(36).slice(2),
    cb: callbackURL,
    intent,
    uid:
      intent === "link"
        ? (locals.user?.user.id ?? null)
        : intent === "re-sign-in"
          ? url.searchParams.get("uid")
          : null,
  });

  const redirectUri = `${url.origin}/auth/api/github/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    allow_signup: "true",
  });
  const authUrl = `https://github.com/login/oauth/authorize?${params}`;
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Redirecting to GitHub</title></head><body><script>location.replace(${JSON.stringify(authUrl)})</script></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
};
