<h1 align="center"> <img src="assets/logo.png" width="100" valign="middle"/> Arranger</h1>
<p align="center">Minimal, functional, and offline-friendly todo lists for personal daily use.</p>



## About the Project (WIP)

A self-hosted productivity web app inspired by Things for macOS, focused on smooth motion and a clean interface. Built from scratch to learn modern full-stack development; **not affiliated with anyone**.

A deployed [demo](https://arranger.gwo.me) reflects current progress.

## Tech Stack

**_Docker · Bun · Typescript · SvelteKit + Svelte 5 · Tailwind CSS · PostgreSQL · Drizzle ORM_**

Dependencies:

- `better-auth` for auth
- `zod` for validation
- `@internationalized/date` for date utils
- `iconify` for icons
- all UI components hand-rolled

## Features / Goals

- **Chrome & Safari** — cross-browser support
- **Projects** — create, rename, archive, and trash; contains todos and groups (visual dividers)
- **Todos** — title, note, planned date, completion status, and nested checks
- **Date picker** — "infinite"-scroll calendar and natural language parser (e.g. "2nd fri in may", "2 days before oct 11")
- **Drag-and-drop** — intuitive way to move things around
- **Functional views** — Inbox, Planned, Archive, Trash, and Projects list
- **Search** — full-text search across todos and projects, with filters
- **Panels** — resizable multi-panel layout for placing views side by side; collapsible side bar, popup sub-panel, and switcher for quick navigation
- **Offline-friendly sync** — sequence-stamped server cache for delta fetches, with local mutation overlay for optimistic UI and push composition
- **User account** — sign up, sign in, and basic account management
- **Multi-client ready** — server-side conflict resolution for concurrent clients

## Todos / Progress

- **UI**
  - [x] infinite-scroll calendar
    - renders only months within the viewport + buffer
    - month indicator overlay during scroll
    - "back to today" button when scrolled far
  - [x] natural language date parser
    - regex-based; combinable semantics: day-of-week, ordinal, duration offset, week/month/year range
    - multiple candidates for ambiguous input; narrows as you type
  - [x] drag and drop
    - generic drag-insert-list component (reusable; phantom preview; multi-row drag)
    - todos and groups movable across projects via sidebar or popup sub-panel
    - check dragging area confined
  - [x] multi-panel layout
    - resizable panels with drag handles; collapsible sidebar
    - popup sub-panels: open, close, duplicate
    - panel switcher for quick view navigation
  - [x] project view
    - sidebar proj-list: drag-to-reorder, inline rename
    - detail view: name, note, groups, todos
    - auto-scroll when todos are dragged near the edges
  - [x] todo view
    - expandable card; title/note editing; nested checks
    - icon bar for planned date and check actions
    - keyboard shortcuts to delete/create/navigate checks
    - line-break handling on paste
  - [x] row operations
    - multi-select (ctrl/cmd+click); right-click context menu
    - create button; auto-scroll to new row
  - [ ] functional views
    - Inbox, Planned, Archive, Trash
    - shells exist; need type design and live data post-sync
  - [ ] refined todo view
    - planned date and note badges when collapsed
    - icon bar fade-out with better spacing
    - wire up the date parser
  - [ ] in-panel page navigation
    - navigate to project view from Archive/Trash entries
    - breadcrumb navigation to go back
  - [ ] auth/account pages
    - sign-in / sign-up forms; email verification flow
    - profile, password change, sign-out
  - [ ] sync indicator and error log page
  - [ ] basic keyboard support
- **Client**
  - [x] unified mutator layer
    - separate local and remote persistable mutation paths
    - Svelte context-bound; all state writes go through one interface
  - [x] sync protocol schemas
    - Zod types for push/pull payloads, sparse position specs, scoped deltas
  - [ ] mutation overlay
    - sits above the server cache; overlay-merged state for optimistic UI
    - stamps mutations with pushSeq; mutation queue for push, per-field map for UI reads
  - [ ] sync engine
    - pull: delta-fetch per scope by syncedAtSeq; seed on load, re-fetch when stale or on a timer
    - push: compose and batch pending mutations; one in-flight at a time
    - reconcile mutations on response; evict cache under memory pressure
    - capture and surface sync errors (network vs. conflict); retry with backoff
  - [ ] undo/redo for moves
    - revert project and todo moves (command pattern over mutator layer)
  - [ ] preference persistence to localStorage
- **Server**
  - [x] database schema
    - users, projects, groups, todos, checks
    - append-only scope-tagged update logs per entity for delta sync
  - [x] auth setup
    - better-auth with email/password and Google OAuth configured
  - [ ] auth routes
    - sign-up, sign-in, sign-out, session management (better-auth handlers)
    - email verification; password reset via email link
  - [ ] pull endpoint
    - accept (scope, syncedAtSeq); return delta or full snapshot if absent
  - [ ] push endpoint
    - accept (mutations, syncedAtSeq); apply in order; resolve conflicts; return delta
    - enforce limits (500 rows/project · 100 checks/todo)
- **Someday**
  - [ ] search view and server logic
  - [ ] project export
  - [ ] end-to-end encryption

## Dev Setup

1. Open in VSCode devcontainer
2. Run `bun run dev --host`
3. Visit `http://localhost:5173`

## Production

```sh
# start
docker compose -f docker-compose.prod.yml up -d

# stop
docker compose -f docker-compose.prod.yml down --remove-orphans
```
