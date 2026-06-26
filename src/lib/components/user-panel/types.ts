export type Credential = {
  providerId: string;
  accountId: string | null;
  email: string | null;
};

export type Me = {
  user: { id: string; name: string | null; email: string | null; resetDisabled: boolean } | null;
  credentials: Credential[];
  sessionFresh: boolean;
};

export type Banner = { kind: "info" | "error"; text: string } | null;

// Last known local session status, derived from what the server last told us.
// The session no longer belongs to the anchored user in the last two cases:
//   "fresh"       — valid, within the freshness window.
//   "stale"       — valid, past the window; sensitive actions re-gate on this.
//   "overwritten" — a loadMe returned a *different* user: the cookie's session
//                   is valid, but for someone else (a swap in another tab).
//   "invalid"     — a loadMe returned no user, or an action returned 401: the
//                   session is gone server-side.
export type SessionStatus = "fresh" | "stale" | "overwritten" | "invalid";

export type OtpOriginator = {
  actorToken: string;
  otp: string;
  email: string;
  type: "signup" | "change-email" | "add-password-cred";
  payload?: { password?: string };
  headline: string;
};

export async function api(op: string, body?: unknown) {
  const r = await fetch(`/auth/api/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let data: any = null;
  try {
    data = await r.json();
  } catch {
    // empty
  }
  return { ok: r.ok, status: r.status, data };
}
