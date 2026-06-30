import type { PageServerLoad } from "./$types";
import { lookupControllerToken } from "$lib/server/user-auth";

// Resolve the controller token on the server so the page is server-rendered in
// its final state (the new-password form, or the invalid notice) instead of
// shipping a "Loading…" placeholder that only resolves after a client fetch.
// Mirrors the GET `reset-destination` API (including its type==="reset" guard).
export type ResetDest = { status: "invalid" } | { status: "loaded"; email: string };

export const load: PageServerLoad = async ({ url }) => {
  const ct = url.searchParams.get("ct") ?? "";
  let dest: ResetDest = { status: "invalid" };
  if (ct) {
    const r = await lookupControllerToken(ct);
    if (r && r.row.type === "reset") dest = { status: "loaded", email: r.row.email };
  }
  return { dest };
};
