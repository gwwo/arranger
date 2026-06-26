import type { user as userTable, session as sessionTable } from "$lib/server/db/auth-schema";

type UserSession = {
  user: typeof userTable.$inferSelect;
  session: typeof sessionTable.$inferSelect;
};

declare global {
  namespace App {
    interface Locals {
      user: UserSession | null;
    }
  }
}

export {};
