import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { ensureDataUser } from "$lib/server/sync-apply";
import { pushBodySchema } from "$lib/server/sync/protocal";
import { applyPush } from "$lib/server/sync/push-handler";

export const POST: RequestHandler = async ({ locals, request }) => {
  const s = locals.user;
  if (!s) error(401, "Not signed in");
  const raw = await request.json().catch(() => null);
  const parsed = pushBodySchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[sync/push] invalid body:", parsed.error.issues);
    error(400, "Invalid push body");
  }
  await ensureDataUser(s.user.id);
  try {
    const result = await applyPush(s.user.id, parsed.data);
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync/push] error:", msg);
    error(500, msg);
  }
};
