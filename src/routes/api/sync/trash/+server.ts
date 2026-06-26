import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { ensureDataUser } from "$lib/server/sync-apply";
import { buildPlacementDelta } from "$lib/server/sync/pull-handler";

export const GET: RequestHandler = async ({ locals }) => {
  const s = locals.user;
  if (!s) error(401, "Not signed in");
  await ensureDataUser(s.user.id);
  const delta = await buildPlacementDelta(s.user.id, "trash");
  return json(delta);
};
