import type { Handle } from "@sveltejs/kit";
import { getSession as getUserSession } from "$lib/server/user-auth";

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const needsSession =
    pathname === "/" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api/");
  if (needsSession) {
    const s = await getUserSession(event);
    event.locals.user = s ?? null;
  }
  return resolve(event);
};
