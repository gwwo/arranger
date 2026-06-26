// Legacy endpoint — superseded by /api/sync/list, /api/sync/proj, /api/sync/inbox, etc.
// Returns 410 Gone so clients upgrading from the old op-log sync know to bootstrap.
import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () => {
  error(410, "Superseded: use /api/sync/list and /api/sync/proj");
};
