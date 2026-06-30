import type { Handle } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { getSession as getUserSession } from "$lib/server/user-auth";

// The logged-out demo is identical for every guest, so render it once (on the
// first guest request) and serve the cached HTML to all later guests. Re-rendered
// each time in dev so edits show up without a restart.
let guestHtml: string | null = null;

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const needsSession =
    pathname === "/" || pathname.startsWith("/auth") || pathname.startsWith("/api/");
  if (needsSession) {
    const s = await getUserSession(event);
    event.locals.user = s ?? null;
  }

  // Logged-out visits to `/` get the rendered guest snapshot (rendered once via
  // the normal `/` SSR path — its gate renders the demo when there's no user —
  // then cached). `/` stays a dynamic SSR route for signed-in users (and for
  // future logged-in SSR). There's no public `/guest` route, so the demo page
  // isn't reachable at any other URL.
  if (pathname === "/" && event.request.method === "GET" && event.locals.user == null) {
    if (guestHtml == null || dev) {
      const res = await resolve(event);
      // Only cache a clean HTML render. A non-200 (error page, redirect) is
      // request-specific — pass it straight through so we never pin an error as
      // the snapshot served to every later guest with a 200.
      if (res.status !== 200) return res;
      guestHtml = await res.text();
    }
    return new Response(guestHtml, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return resolve(event);
};
