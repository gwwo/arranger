import z from "zod";

const checkFields = z.object({
  content: z.string(),
  ticked: z.boolean(),
});

const todoFields = z.object({
  title: z.string(),
  note: z.string(),
  done: z.boolean(),
  planned: z.iso.date().nullable(), // `null` clears the date
});

const groupFields = z.object({ label: z.string() });

const projFields = z.object({
  name: z.string(),
  note: z.string(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUSH
// ═══════════════════════════════════════════════════════════════════════════════
// Workflow:
//  1. Client sends mutation together with syncedAtSeq for the affected scope(s).
//  2. Server tries to apply the mutations, then computes and returns delta from
//     syncedAtSeq to the new head seq (could simply be an ack of what was newly applied).
//  3. Client merges the delta, advances its syncedAtSeq.
//
// Principles:
//  - Co-locate as many userful scopes touched by the mutation into one round trip so the
//    client can advance their `syncedAtSeq` in one step.
//  - Narrow down delta. Avoid sending content the client already has.

// `positionSpec` is used to express a reorder, arrival, or creation of an entry within
// an ordered list.
//
// To sparsely express the change made to an old list, (along with a movedOut record)
// we use a positionSpec array that enumerates entries in their new intended position.
// (Each entry will carry its identity, e.g. checkId, rowId — added by the containing schema).
//
//   `startAtIndex`  — absolute index of this entry in the new list; when omitted,
//                     index is inferred as previous entry's index + 1 (run-length).
//   `moveHere`      — this entry is newly moved to this position.
//   `createHere`    — this entry is being created at this position.
//
// Entries with neither flag set are "untouched", and are sometimes included as
// conflict-resolution context, so the server can make sensible decisions when the list
// has diverged (e.g. landing a moved todo under the right group header even
// when other rows have been inserted or removed since the client's last sync).
const positionSpec = z
  .object({
    startAtIndex: z.int().nonnegative(),
    moveHere: z.boolean(),
    createHere: z.boolean(),
  })
  .partial();

export const todoUpdate = todoFields
  .extend({
    // The seq through which the client has fully received this todo's content.
    // When absent, the server assumes the client has no base version
    syncedAtSeq: z.int().nonnegative(),
    // Sparse new ordering of checks (see positionSpec).
    orderChecks: z.array(positionSpec.extend({ checkId: z.uuid() })),
    // Hard-deletes these checks.
    deleteChecks: z.array(z.uuid()),
    // Partial field edits keyed by checkId.
    editChecks: z.record(z.uuid(), checkFields.partial()),
  })
  .partial()
  .extend({ todoId: z.uuid() });

// Hard-deletes a todo and cascades to its checks.
// Use projUpdate.deleteRows to remove a todo from a project —
// that path advances the per-proj syncedAtSeq in the same request.
//
// `positionSyncedAtSeq` — the seq through which the client has seen this todo's
// placement/position. Distinct from the per-todo content syncedAtSeq in todoUpdate.
// The server uses this to detect a stale delete: if the todo was moved to archive
// after positionSyncedAtSeq, we could reject the delete.
export const todoDelete = z.object({
  todoId: z.uuid(),
  positionSyncedAtSeq: z.int().nonnegative(),
});

export const projUpdate = projFields
  .extend({
    // The seq through which the client has fully received this project's content
    // (rows, their ordering, and their contents, see `projPull`).
    syncedAtSeq: z.int().nonnegative(),
    // Sparse new ordering of proj rows
    orderRows: z.array(
      positionSpec.extend({
        // Server creates a shell with `rowId`, if create data is absent in `editRows`
        rowId: z.uuid(),
        kind: z.enum(["todo", "group"]),
        // The seq through which the client has seen this row's placement/position.
        // Used to detect stale moves.
        positionSyncedAtSeq: z.int().nonnegative().optional(),
      }),
    ),
    // Rows the client is removing from the project. The server uses deleteRows and
    // moveOutRows together to help enforce PROJ_ROW_NUM_LIMIT on the resulting state.
    //
    // Hard-deletes these rows (and cascades to checks for todos).
    deleteRows: z.record(z.uuid(), z.enum(["todo", "group"])),
    // Moves these rows out of the project to the inbox (for todos, if they haven't
    // already been removed from this proj) or discards groups.
    moveOutRows: z.record(z.uuid(), z.enum(["todo", "group"])),
    // Partial field edits for rows keyed by rowId.
    editRows: z.record(
      z.uuid(),
      z.discriminatedUnion("kind", [
        todoUpdate.omit({ todoId: true }).extend({ kind: z.literal("todo") }),
        groupFields
          // syncedAtSeq tracked for the group's content, to narrow down delta
          .extend({ syncedAtSeq: z.int().nonnegative() })
          .partial()
          .extend({ kind: z.literal("group") }),
      ]),
    ),
  })
  .partial()
  .extend({ projId: z.uuid() });

// Hard-deletes a project and cascades to all its rows and checks.
//
// `positionSyncedAtSeq` — guards against stale deletes in the same way as
// todoDelete.
// TBD: should the client send the list of rowIds it believes are in the project
// so the server can surface any rows the client hasn't seen yet before deleting?
export const projDelete = z.object({
  projId: z.uuid(),
  positionSyncedAtSeq: z.int().nonnegative(),
});

// Reorders the user's active project list (placement = "list").
// Field edits (e.g. renaming a project) go through projUpdate, which also
// returns the per-proj content delta — keeping name edits in projsArrange would
// require a separate sync scope for the list view. Commented out for now.
export const projsArrange = z.object({
  orderProjs: z.array(
    positionSpec.extend({
      projId: z.uuid(),
      positionSyncedAtSeq: z.int().nonnegative().optional(),
    }),
  ),
  // editProjs: z.record(
  //   z.uuid(),
  //   projFields.pick({ name: true }).extend({ syncedAtSeq: z.int().nonnegative() }).partial(),
  // ),
});

// Expresses the arrival (and relative ordering) of entries newly entering the
// archive. Archive/trash use chronological order, so
// `slice` is only the set of entries the client is moving in — not a full
// reorder of the view. Technically, there's only move-in to the top and move-out of Archive.
export const archiveArrange = z.object({
  slice: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("proj"),
        projId: z.uuid(),
        createHere: z.boolean().optional(),
        positionSyncedAtSeq: z.int().nonnegative().optional(),
      }),
      z.object({
        kind: z.literal("todo"),
        todoId: z.uuid(),
        createHere: z.boolean().optional(),
        positionSyncedAtSeq: z.int().nonnegative().optional(),
        // `associateProjId` — for archived todos, records the project they belonged to
        // at the time of client-side archving, so we can display them for a proj.
        associateProjId: z.uuid().optional(),
      }),
    ]),
  ),
});

export const trashArrange = archiveArrange;

export const inboxArrange = z.object({
  slice: z.array(
    z.object({
      todoId: z.uuid(),
      createHere: z.boolean().optional(),
      positionSyncedAtSeq: z.int().nonnegative().optional(),
    }),
  ),
});

// ═══════════════════════════════════════════════════════════════════════════════
// PULL
// ═══════════════════════════════════════════════════════════════════════════════
 
// Pull the content of a project: projFields + row ordering/exits +
// todoFields/groupFields for each row + check ordering/exits + checkFields.
export const projPull = z.object({
  projId: z.uuid(),
  // The seq through which the client has fully received this project's content.
  // Absent → full bootstrap (first load or cache miss).
  syncedAtSeq: z.int().nonnegative().optional(),
  // Per-todo content seqs the client already holds that are ahead of syncedAtSeq.
  // This happens when the server previously returned a todoUpdate reponse stamped
  // with a seq newer than the project's syncedAtSeq (e.g. an isolated todo edit
  // that happened before the next full project pull).
  todoSyncedAtSeq: z.record(z.uuid(), z.int().nonnegative()).optional(),
});

// Pull the full content of a single todo: todoFields + check ordering/exits + checkFields.
export const todoPull = z.object({
  todoId: z.uuid(),
});

// Pull the user's active project list: proj ordering/exits, and proj names.
export const projListPull = z.object({
  syncedAtSeq: z.int().nonnegative().optional(),
});

// Pull a view of the archive/trash/inbox: an ordered list of entry ids, kinds, and names.
// TBD: add syncedAtSeq for delta pulls and pagination for large dataset.
export const archivePull = z.object({});
export const trashPull = z.object({});
export const inboxPull = z.object({});
