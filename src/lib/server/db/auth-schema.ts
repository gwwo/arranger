import { defineRelations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";

export const credentialProvider = pgEnum("credential_provider", ["password", "google", "github"]);
export const otpVerificationType = pgEnum("otp_verification_type", [
  "signup",
  "change-email",
  "add-password-cred",
]);
export const ctrlVerificationType = pgEnum("ctrl_verification_type", ["reset", "signup"]);

// A user has 0 or 1 'password' credential row and 0 or 1 'google' credential row.
// Invariant: user.email IS NOT NULL ⟺ user has a 'password' credential row.
// The OAuth `email` claim lives on the Google credential row and is never
// copied onto user.email.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  // Optional user-chosen label. Never populated from OAuth claims; the UI
  // shows a "User" placeholder when null.
  name: text("name"),
  // Correspondent email; non-null iff user has a password credential row.
  email: text("email").unique(),
  // When true, §2 reset-password-via-email is refused. Recovery then requires
  // a linked Google credential (sign in via Google → flip this off → reset).
  resetDisabled: boolean("reset_disabled").default(false).notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

// One row per credential. providerId discriminates: 'password' rows carry
// passwordHash and have NULL accountId / email — the email lives on
// user.email and the row is identified by (userId, providerId='password').
// OAuth rows ('google') carry accountId (the provider's id for the user,
// e.g. Google's `sub`, non-null), the `email` claim, and OAuth tokens.
export const credential = pgTable(
  "credential",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id"),
    providerId: credentialProvider("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email"),
    passwordHash: text("password_hash"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("credential_userId_idx").on(table.userId)],
);

// Reverse-OTP rows. actorToken goes to the originator browser, verifierToken
// is embedded in the email link. Both are unique-indexed for direct lookup.
export const otpVerification = pgTable("otp_verification", {
  id: text("id").primaryKey(),
  actorToken: text("actor_token").notNull().unique(),
  verifierToken: text("verifier_token").notNull().unique(),
  otp: text("otp").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  verified: boolean("verified").default(false).notNull(),
  type: otpVerificationType("type").notNull(),
  email: text("email").notNull(),
  // Signed-in flows (change-email, add-credential) bind the row to the
  // originator session; consume rejects unless session.user.id matches.
  originUserId: text("origin_user_id").references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
});

// Single-use destination-side commit tokens. Used as the primary path for
// password reset and as the cap-notice escape hatch for sign-up-shape flows.
export const ctrlVerification = pgTable("control_verification", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  type: ctrlVerificationType("type").notNull(),
  email: text("email").notNull(),
  // Same binding semantics as otpVerification.originUserId.
  originUserId: text("origin_user_id").references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
});

export const authRelations = defineRelations(
  { user, session, credential, otpVerification, ctrlVerification },
  (r) => ({
    user: {
      sessions: r.many.session(),
      credentials: r.many.credential(),
    },
    session: {
      user: r.one.user({
        from: r.session.userId,
        to: r.user.id,
      }),
    },
    credential: {
      user: r.one.user({
        from: r.credential.userId,
        to: r.user.id,
      }),
    },
  }),
);
