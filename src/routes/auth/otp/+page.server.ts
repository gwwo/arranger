import type { PageServerLoad } from "./$types";
import { loadDestination, type OtpDestState } from "$lib/server/user-auth";

// Resolve the verifier token on the server so the page is server-rendered in
// its final state (the code form, or the invalid/verified notice) instead of
// shipping a "Loading…" placeholder that only resolves after a client fetch.
// Mirrors the GET `otp-destination` API, which the client still uses to
// re-validate on bfcache restore.
export const load: PageServerLoad = async ({ url }) => {
  const vt = url.searchParams.get("vt") ?? "";
  const dest: OtpDestState = vt ? await loadDestination(vt) : { status: "invalid" };
  return { dest };
};
