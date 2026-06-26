// Legacy file — kept for the `ensureDataUser` export used by route handlers
// and the page server load. All sync logic has moved to src/lib/server/sync/.

import { eq } from "drizzle-orm";
import { db } from "./db";
import { userTable } from "./db/schema";

// ─── User bootstrap ──────────────────────────────────────────────────────────

export async function ensureDataUser(authUserId: string): Promise<void> {
  await db
    .insert(userTable)
    .values({ id: authUserId })
    .onConflictDoNothing({ target: userTable.id });
}
