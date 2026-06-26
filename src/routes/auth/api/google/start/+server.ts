import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import { signState } from "$lib/server/user-auth";

const SCOPE = ["openid", "email", "profile"].join(" ");

export const GET: RequestHandler = async ({ url, locals }) => {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) error(500, "GOOGLE_CLIENT_ID not configured");
  const rawIntent = url.searchParams.get("intent");
  const intent: "sign-in" | "link" | "re-sign-in" =
    rawIntent === "link" ? "link" : rawIntent === "re-sign-in" ? "re-sign-in" : "sign-in";
  const callbackURL = url.searchParams.get("callbackURL") ?? "/auth/oauth-done";

  const state = signState({
    n: Math.random().toString(36).slice(2),
    cb: callbackURL,
    intent,
    // link: the linking user must be signed in, so take uid from the session.
    // re-sign-in: the cookie may be gone or hold a different user, so the
    //   client carries the user it wants to re-sign-in as; the callback proves
    //   it by checking the authenticated Google account is linked to that uid.
    // sign-in: no uid.
    uid:
      intent === "link"
        ? (locals.user?.user.id ?? null)
        : intent === "re-sign-in"
          ? url.searchParams.get("uid")
          : null,
  });

  const redirectUri = `${url.origin}/auth/api/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "login", // force re-auth on Google's side every time
    state,
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Redirecting to Google</title></head><body><script>location.replace(${JSON.stringify(authUrl)})</script></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
};
