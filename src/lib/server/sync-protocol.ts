// ─── Single-client optimistic-push sync protocol ─────────────────────────────
//
// Client applies mutations locally, enqueues ops, and pushes them serially.
// On startup, the client pulls the full state. There is no delta/log-based
// pull and no conflict resolution — single-client only.
//
// Each user action emits 1 or more ops. Reorders carry the full new order of
// the affected scope; server rewrites sortKeys densely (0..n-1).
// Cross-project row moves are expressed as two reorders: one for the
// destination project (including the moved row) and one for the source.
//
// IDs are UUIDs minted by the client; server respects them.

import { z } from "zod";

const uuid = z.uuid();
const dateStr = z.iso.date().nullable(); // YYYY-MM-DD or null

const rowKind = z.enum(["todo", "group"]);

export const opSchema = z.discriminatedUnion("kind", [
  // ─── projects ────────────────────────────────────────────────────────────
  z.object({
    kind: z.literal("proj.create"),
    id: uuid,
    name: z.string(),
    note: z.string(),
  }),
  z.object({
    kind: z.literal("proj.update"),
    id: uuid,
    name: z.string().optional(),
    note: z.string().optional(),
  }),
  z.object({ kind: z.literal("proj.delete"), id: uuid }),
  // Full new order of the user's active project list (placement = "list").
  z.object({ kind: z.literal("proj.reorder"), order: z.array(uuid) }),

  // ─── todos ───────────────────────────────────────────────────────────────
  z.object({
    kind: z.literal("todo.create"),
    id: uuid,
    projId: uuid,
    title: z.string(),
    note: z.string(),
    done: z.boolean(),
    planned: dateStr,
  }),
  z.object({
    kind: z.literal("todo.update"),
    id: uuid,
    title: z.string().optional(),
    note: z.string().optional(),
    done: z.boolean().optional(),
    planned: dateStr.optional(),
  }),
  z.object({ kind: z.literal("todo.delete"), id: uuid }),

  // ─── groups ──────────────────────────────────────────────────────────────
  z.object({
    kind: z.literal("group.create"),
    id: uuid,
    projId: uuid,
    label: z.string(),
  }),
  z.object({
    kind: z.literal("group.update"),
    id: uuid,
    label: z.string().optional(),
  }),
  z.object({ kind: z.literal("group.delete"), id: uuid }),

  // Full new row order within a project. Each row is set to projId + sortKey=i.
  // This also handles moved-in rows (their projId is overwritten).
  z.object({
    kind: z.literal("row.reorder"),
    projId: uuid,
    order: z.array(z.object({ kind: rowKind, id: uuid })),
  }),

  // ─── checks ──────────────────────────────────────────────────────────────
  z.object({
    kind: z.literal("check.create"),
    id: uuid,
    todoId: uuid,
    content: z.string(),
    ticked: z.boolean(),
  }),
  z.object({
    kind: z.literal("check.update"),
    id: uuid,
    content: z.string().optional(),
    ticked: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("check.delete"), id: uuid }),
  z.object({
    kind: z.literal("check.reorder"),
    todoId: uuid,
    order: z.array(uuid),
  }),
]);

export type Op = z.infer<typeof opSchema>;

export const pushBodySchema = z.object({
  ops: z.array(opSchema),
});
export type PushBody = z.infer<typeof pushBodySchema>;

// ─── Pull state shape (what /api/sync/pull returns) ──────────────────────────

export type PullCheck = {
  id: string;
  content: string;
  ticked: boolean;
};

export type PullTodoRow = {
  kind: "todo";
  id: string;
  title: string;
  note: string;
  done: boolean;
  planned: string | null; // YYYY-MM-DD
  checks: PullCheck[];
};

export type PullGroupRow = {
  kind: "group";
  id: string;
  label: string;
};

export type PullProject = {
  id: string;
  name: string;
  note: string;
  rows: (PullTodoRow | PullGroupRow)[];
};

export type PullState = {
  projects: PullProject[];
};
