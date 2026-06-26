import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { ensureDataUser } from "$lib/server/sync-apply";
import { projPull } from "$lib/server/sync/protocal";
import { buildProjDelta } from "$lib/server/sync/pull-handler";

export const POST: RequestHandler = async ({ locals, request }) => {
  const s = locals.user;
  if (!s) error(401, "Not signed in");
  const raw = await request.json().catch(() => null);
  const parsed = projPull.safeParse(raw);
  if (!parsed.success) error(400, "Invalid pull body");
  await ensureDataUser(s.user.id);
  const delta = await buildProjDelta(s.user.id, parsed.data.projId, parsed.data.syncedAtSeq);
  return json(delta);
};
