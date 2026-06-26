// Shared wire-format types for the delta sync protocol.
// Push schemas live in protocal.ts (Zod). This file contains the derived
// TypeScript types plus the pull response shapes.

import type z from "zod";
import type {
  projUpdate,
  projDelete,
  projsArrange,
  archiveArrange,
  trashArrange,
  inboxArrange,
  todoUpdate,
  todoDelete,
} from "./protocal";

// ─── Push body ───────────────────────────────────────────────────────────────

export type PushBody = {
  projUpdates?: z.infer<typeof projUpdate>[];
  projDeletes?: z.infer<typeof projDelete>[];
  projsArrange?: z.infer<typeof projsArrange>;
  archiveArrange?: z.infer<typeof archiveArrange>;
  trashArrange?: z.infer<typeof trashArrange>;
  inboxArrange?: z.infer<typeof inboxArrange>;
  todoUpdates?: z.infer<typeof todoUpdate>[];
  todoDeletes?: z.infer<typeof todoDelete>[];
};

// ─── Pull response shapes ─────────────────────────────────────────────────────

export type PullCheck = {
  id: string;
  content: string;
  ticked: boolean;
  sortKey: number;
};

export type PullTodoRow = {
  kind: "todo";
  id: string;
  title: string;
  note: string;
  done: boolean;
  planned: string | null;
  sortKey: number;
  checks: PullCheck[];
};

export type PullGroupRow = {
  kind: "group";
  id: string;
  label: string;
  sortKey: number;
};

export type PullRow = PullTodoRow | PullGroupRow;

export type ProjDelta = {
  newSeq: number;
  // Full state for newly seen rows (entered or bootstrap).
  enteredRows: PullRow[];
  // Field changes for rows the client already knew about. Only changed fields are included.
  changedRows: ChangedRow[];
  // Row IDs that left this project since syncedAtSeq.
  exitedRowIds: string[];
  // If the project's own fields changed.
  projFields?: { name?: string; note?: string };
};

export type ChangedRow =
  | { kind: "todo"; id: string; title?: string; note?: string; done?: boolean; planned?: string | null }
  | { kind: "group"; id: string; label?: string };

// ─── Push response ────────────────────────────────────────────────────────────

export type PushResponse = {
  ok: true;
  newSeq: number;
  projDeltas?: Record<string, ProjDelta>;
  projListDelta?: ProjListDelta;
  inboxDelta?: PlacementDelta;
  archiveDelta?: PlacementDelta;
  trashDelta?: PlacementDelta;
};

// ─── Project list ─────────────────────────────────────────────────────────────

export type ProjListEntry = {
  id: string;
  name: string;
  note: string;
  sortKey: number;
  placement: "list" | "archive" | "trash";
};

export type ProjListDelta = {
  newSeq: number;
  // The complete ordered list of active projects (always full for now).
  projects: ProjListEntry[];
};

// ─── Placement views (inbox / archive / trash) ────────────────────────────────

export type PlacementTodoEntry = {
  kind: "todo";
  id: string;
  title: string;
  note: string;
  done: boolean;
  planned: string | null;
  sortKey: number;
  projId: string | null;
};

export type PlacementProjEntry = {
  kind: "proj";
  id: string;
  name: string;
  sortKey: number;
};

export type PlacementEntry = PlacementTodoEntry | PlacementProjEntry;

export type PlacementDelta = {
  newSeq: number;
  // Full list (no delta yet — inbox/archive/trash always return everything).
  entries: PlacementEntry[];
};
