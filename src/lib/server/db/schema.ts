import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userTable = pgTable(
  "user_table",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    email: text("email").notNull(),
    // User-wise global monotonic counter. Each mutation increments this within a
    // transaction and stamps the corresponding update-log rows with createdAtSeq.
    // All write transactions for a user must be serialized; use `select ... for update` at the beginning;
    // we can consider a mutateSeq per project to allow concurrent writes of different projects
    mutateSeq: integer("mutate_seq").notNull().default(0),
    // Per-placement seq counters used to derive sortKey for newly appended
    // items in archive/inbox/trash (chronological ordering within those views).
    // Note that proj's list-placement uses manual sortKey, as with todo/group's proj-placement.
    archiveSortSeq: integer("archive_sort_seq").notNull().default(0),
    inboxSortSeq: integer("inbox_sort_seq").notNull().default(0),
    trashSortSeq: integer("trash_sort_seq").notNull().default(0),
  },
  (t) => [uniqueIndex("users_email_uniq").on(t.email)],
);

// ─── Limits to impose at application level ────────────────────────────────────
//
// limit the total number of todos/groups in a proj; duplicate proj to hold overflows
export const PROJ_ROW_NUM_LIMIT = 500;
// limit the number of projects in a user's active all-proj list.
export const PROJ_NUM_LIMIT = 200;
// limit the number of checks a todo can have
export const TODO_CHECK_NUM_LIMIT = 100;

// TODO: add indices on tables


// ─── Sync models ──────────────────────────────────────────────────────────────
//
// Scope-tagged pull sync (this design)
//   Mutations are stamped with coarse, stable scopes at write time. Clients pull
//   on demand — present a scope and syncedAtSeq, server queries a universal log and returns
//   the delta.
// Predicate-push sync
//   Clients pre-register a fine-grained predicate. At write time, the server
//   evaluates which subscriptions match and pushes or logs the delta per
//   subscriber.
//
// Clients track the `syncedAtSeq` for the content they have fully received per scope (a project,
// or a placement like inbox/archive/trash) and request deltas from there.
//
// ─── Example: delta for todos in project P since seq N), composed at the server using updateLogs ───
//
//   adjacentEnter = SELECT todoId FROM todoUpdateLog
//                   WHERE projId=? AND update IN ('enter','exit') AND createdAtSeq > N
//                   GROUP BY todoId
//                   HAVING MIN(createdAtSeq) = MIN(CASE WHEN update='enter' THEN createdAtSeq END)
//                   -- earliest event in window is an enter
//
//   adjacentExit  = SELECT todoId FROM todoUpdateLog
//                   WHERE projId=? AND update IN ('enter','exit') AND createdAtSeq > N
//                   GROUP BY todoId
//                   HAVING MIN(createdAtSeq) = MIN(CASE WHEN update='exit' THEN createdAtSeq END)
//                   -- earliest event in window is an exit
//
//   present = select todoId from todoTable where placement="proj" and projId = P
//
//   Four cases:
//   adjacentEnter & in present     → truly entered
//   adjacentEnter & not in present → entered then exited:    ignore
//   adjacentExit  & in present     → exited then re-entered
//   adjacentExit  & not in present → truly exited:           tell client to remove
//
//   The client at seq = N has already seen all todos where:
//     seen = todoId IN (present) AND todoId NOT IN adjacentEnter
//   (i.e. todos that were present before N and didn't newly enter during the window)
//
//   To get field-changes for those todos since seq N:
//     SELECT todoId, update, MAX(createdAtSeq) FROM todoUpdateLog
//     WHERE projId = P AND createdAtSeq > N AND update NOT IN ('enter', 'exit')
//       AND todoId IN (seen)
//     GROUP BY todoId, update
//
//   If we also track per-todo syncedAtSeq on the client, we can further
//   narrow deltas per todo instead of using a single project-level N.

// ─── A. Current-state tables (no temporal columns) ────────────────────────────

export const projPlacement = pgEnum("proj_placement", ["archive", "trash", "list"]);
// "list" = the user's active all-project list (not yet archived or trashed)

export const projTable = pgTable("proj_table", {
  id: uuid("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => userTable.id),
  placement: projPlacement("placement").notNull(),
  sortKey: integer("sort_key").notNull(),
  name: text("name"),
  note: text("note"),
});

export const rowStatus = pgEnum("row_status", ["frozen", "active"]);
// proj-row = group | todo, sharing the same sortKey space.
// A proj-row is frozen when it (or its containing project) is moved to archive/trash. In other words, 
// we propagate the signal to the proj-rows directly at write time of "proj enters archive/trash", 
// supposed to be a read-path optimization

// Frozen rows reject mutations except, e.g. when the client deliberately
// (syncedAtSeq > the seq that caused the freeze) unfreezes a todo
// and mutates its position/note/placement

// Groups are essentially visual dividers in the app ui, and always scoped to a project.
// Cross-project moves are modelled as delete + create;
// client sends {copyGroupId, copyLabel}; server creates new groupId in the target project.
export const groupTable = pgTable("group_table", {
  id: uuid("id").primaryKey(),
  projId: uuid("proj_id")
    .notNull()
    .references(() => projTable.id),
  label: text("label"),
  sortKey: integer("sort_key").notNull(),
  status: rowStatus("status").notNull(),
});

export const todoPlacement = pgEnum("todo_placement", ["archive", "trash", "project", "inbox"]);

export const todoTable = pgTable("todo_table", {
  id: uuid("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => userTable.id),
  placement: todoPlacement("placement").notNull(),
  status: rowStatus("status").notNull(),
  // projId must be non-null when in proj-placement; application-enforced
  projId: uuid("proj_id").references(() => projTable.id),
  sortKey: integer("sort_key").notNull(),
  title: text("title"),
  note: text("note"),
  done: boolean("done").notNull().default(false),
  planned: date("planned"),
});

export const checkTable = pgTable("check_table", {
  id: uuid("id").primaryKey(),
  todoId: uuid("todo_id")
    .notNull()
    .references(() => todoTable.id),
  sortKey: integer("sort_key").notNull(),
  content: text("content").notNull(),
  ticked: boolean("ticked").notNull().default(false),
});

// ─── B. Update logs (append-only; scope-tagged) ────────────────────────────────────────────
// Each log row records (the change, the context, the seq-stamp):
// entity id, field/lifecycle-event, the associated scope at time of write,
// and createdAtSeq = mutateSeq at time of write.
// Log rows are never updated. Old rows may be
// truncated up to a checkpoint seq, but the truncation policy is TBD. We could send the full current state
//  when client has `syncedAtSeq` older than the `oldestValidSeq` checkpoint

export const projUpdate = pgEnum("proj_update", ["enter", "exit", "name", "note", "position"]);
// "position" change is only meaningful in placement="list"; archive/trash use chronological order
// position changes when the relative order changes, not necessarily when the sortKey changes

export const projUpdateLog = pgTable("proj_update_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // to scope a log query to a user's proj-list/archive/trash
  userId: integer("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  // No FK on projId; we need exit logs of deleted projs.
  projId: uuid("proj_id").notNull(),
  placement: projPlacement("placement").notNull(),
  update: projUpdate("update").notNull(),
  createdAtSeq: integer("created_at_seq").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groupUpdate = pgEnum("group_update", [
  "enter",
  "exit", // also serves as the (hard-)deletion event;
  // groups have no archive/trash and don't really move across projs
  "label",
  "position",
  "status",
]);

export const groupUpdateLog = pgTable("group_update_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Even though we will only scope query on group log to proj,
  // the addition of userId is for later oldestValidSeq design
  userId: integer("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  groupId: uuid("group_id").notNull(),
  // cascade FK on projId; groups won't outlive the proj they live in
  projId: uuid("proj_id")
    .notNull()
    .references(() => projTable.id, { onDelete: "cascade" }),
  update: groupUpdate("update").notNull(),
  createdAtSeq: integer("created_at_seq").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const todoUpdate = pgEnum("todo_update", [
  "enter",
  "exit",
  "title",
  "note",
  "done", // toggling the completion checkbox
  "planned",
  "position",
  "status", // frozen <=> active (see rowStatus)
]);

export const todoUpdateLog = pgTable("todo_update_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // to scope a log query to a user's inbox/archive/trash
  userId: integer("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  // No FK on todoId; we need exit logs of deleted todos
  todoId: uuid("todo_id").notNull(),
  // placement + projId = a write-time scope tag
  placement: todoPlacement("placement").notNull(),
  // No FK on projId; todos may outlive the proj they once reside in
  // We will manually clear logs for deleted todos in deleted projs
  projId: uuid("proj_id"),
  update: todoUpdate("update").notNull(),
  createdAtSeq: integer("created_at_seq").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const checkUpdate = pgEnum("check_update", [
  "enter",
  "exit", // deletion; checks cannot be moved across todos
  "content",
  "ticked",
  "position",
]);

export const checkUpdateLog = pgTable("check_update_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  checkId: uuid("check_id").notNull(),
  // FK on todoId; checks won't outlive it
  todoId: uuid("todo_id")
    .notNull()
    .references(() => todoTable.id, { onDelete: "cascade" }),
  // it inherits the parent todo's context at write time,
  // enabling WHERE projId=P AND createdAtSeq>N to find all check changes relevant to project P.
  placement: todoPlacement("placement").notNull(),
  projId: uuid("proj_id"),
  update: checkUpdate("update").notNull(),
  createdAtSeq: integer("created_at_seq").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
