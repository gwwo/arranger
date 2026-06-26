

## Database Schema

### Current-state tables (no temporal columns)

**user_table**
- `id` — PK, FK → auth user (cascade)
- `mutateSeq` — user-wide monotonic counter; stamped onto log rows as `createdAtSeq`
- `archiveSortSeq`, `inboxSortSeq`, `trashSortSeq` — per-placement counters used to derive `sortKey` for items appended to those views

**proj_table**
- `id` — PK (uuid)
- `userId` — FK → user_table (cascade)
- `placement` — enum: `archive` | `trash` | `list` (`list` = the all-proj list)
- `sortKey` — ordering within the placement
- `name`, `note`

**group_table**
- `id` — PK (uuid)
- `projId` — FK → proj_table (cascade); always scoped to a project
- `sortKey` — share `sortKey` space with todos in the same proj
- `label`

**todo_table**
- `id` — PK (uuid)
- `userId` — FK → user_table (cascade)
- `placement` — enum: `archive` | `trash` | `project` | `inbox`
- `projId` — FK → proj_table; non-null when in `project` placement (app-enforced)
- `sortKey`
- `title`, `note`, `done`, `planned`

**check_table** — checklist items under a todo.
- `id` — PK (uuid)
- `todoId` — FK → todo_table (cascade)
- `sortKey`
- `content`, `ticked`

### Update logs (append-only, scope-tagged)

Each row records: entity id, the change (field or lifecycle event), the scope at write time, e.g. `placement="project"` + `projId` for a todo, and `createdAtSeq` (the `mutateSeq` value at write time). Rows are never updated.

**proj_update_log**
- `id` — PK (identity)
- `userId` — FK → user_table (cascade); scopes queries to a user's list/archive/trash
- `projId` — no FK (need exit logs of deleted projs)
- `placement` — enum (proj placement)
- `update` — enum: `enter` | `exit` | `name` | `note` | `position`
- `createdAtSeq`

**group_update_log**
- `id` — PK (identity)
- `userId` — FK → user_table (cascade)
- `groupId` — no FK
- `projId` — FK → proj_table (cascade); groups don't outlive their proj
- `update` — enum: `enter` | `exit` | `label` | `position`
- `createdAtSeq`

**todo_update_log**
- `id` — PK (identity)
- `userId` — FK → user_table (cascade)
- `todoId` — no FK (need exit logs of deleted todos)
- `placement` — enum (todo placement)
- `projId` — no FK (todos may outlive the proj they once resided in)
- `update` — enum: `enter` | `exit` | `title` | `note` | `done` | `planned` | `position`
- `createdAtSeq`

**check_update_log**
- `id` — PK (identity)
- `userId` — FK → user_table (cascade)
- `checkId` — no FK
- `todoId` — FK → todo_table (cascade); checks don't outlive their todo
- `placement`, `projId` — inherited from parent todo at write time (lets `WHERE projId=P` find check changes for a project)
- `update` — enum: `enter` | `exit` | `content` | `ticked` | `position`
- `createdAtSeq`



- `position` logs fire when relative order changes (not necessarily on every `sortKey` change); meaningful only in manually-ordered placements (`list`/`project`), since archive/inbox/trash use chronological order.
> there could be order change too in those placements. what if an archived todo with sortKey = 100 got re-archived at the front with sortKey = 999? 

> we will use pagination for archive, inbox, trash view, since there can be rows piling up. how to hanle delta-snyc for some view-page-#xxx or should we do delta sync?


### Application-level limits

- `PROJ_ROW_NUM_LIMIT` = 500 — todos + groups per project
- `PROJ_NUM_LIMIT` = 200 — projects in the user's proj-list
- `TODO_CHECK_NUM_LIMIT` = 100 — checks per todo


## Sync Principles

Mutation of entities

project
- field change
- placement change
- position change



todo
- field change
- placement change
- position change

check
- field change
- position change


- conflate mutation to request i.e. current diff, not history
- consider concurrent client sync
- facilate the imposition of PROJ_ROW_NUM_LIMIT and TODO_CHECK_NUM_LIMIT
- 

- server: last write win unless 
- client: preserve unsynced mutation while sync come in, unless the entity is newly frozen by another client.


we need to organise the mutation push to
- send diff
- impose the PROJ_ROW_NUM_LIMIT and TODO_CHECK_NUM_LIMIT in the face of concurrent client sync.

pagination


last write win with exception that when the entity is archived or trashed, we reject any mutation unless the client has been synced to that archived/trashed state. 



