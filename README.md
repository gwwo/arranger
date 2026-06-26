<h1 align="center"> <img src="assets/logo.png" width="100" valign="middle"/> Arranger</h1>
<p align="center">Minimal, functional, and offline-friendly todo lists for personal daily use.</p>



## About the Project (WIP)

A self-hosted productivity web app inspired by Things for macOS, focused on smooth motion and a clean interface. Built from scratch to learn modern full-stack development; **not affiliated with anyone**.

A deployed [demo](https://arranger.gwo.me) reflects current progress.



https://github.com/user-attachments/assets/50ac0b47-6da0-49a4-82dd-7b5b13afeae9



## Tech Stack

**_Docker · Bun · Typescript · SvelteKit + Svelte 5 · PostgreSQL_**

- `tailwindcss` for styling
- `drizzle-orm` for type-safe database access
- `zod` for validation
- `@internationalized/date` for date utils
- `iconify` for icons

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
- **User account** — sign up, sign in, email verification, Oauths, and account management
- **Concurrent-write robust** — server-side conflict resolution and client-side reconciliation for concurrent writes


## Current Task

A well-rounded sync system.

## Dev Setup

Requires only **Docker** and **VSCode** (with the Dev Containers extension) on your machine — Bun, Postgres, and all tooling run inside the containers.

1. Create your env file: `cp .env.example .env` — the defaults work out of the box. (Do this first: reopening starts the Postgres container, which reads `.env`.)
2. Open the repo in VSCode and run **Dev Containers: Reopen in Container**.
3. Create the database tables from the schema: `bunx drizzle-kit push`.
4. Start the dev server: `bun run dev --host`.
5. Visit `http://localhost:5173`.

## Deploy to your VPS

A single VPS running Docker, where the whole stack runs as Docker Compose containers — Caddy (TLS), the SvelteKit app, and Postgres. 

```
Internet → (DNS / optional Cloudflare) → Caddy (TLS, :80/:443) → web (Bun + SvelteKit) → db (Postgres)
```

You build and deploy entirely from your laptop over an SSH Docker context — no git repo is checked out on the server. For that, create the context on your laptop beforehand: `docker context create myserver --docker "host=ssh://user@your-vps"`.

### 1. Point your domain at the VPS

Add a DNS `A` record `your-domain.com → <VPS public IP>`. Caddy provisions a Let's Encrypt cert automatically the first time the stack starts.

> Behind Cloudflare's proxy? Set SSL/TLS mode to **Full (strict)**. Otherwise Cloudflare talks HTTP to the origin, Caddy keeps redirecting it to HTTPS, and you get a redirect loop.

### 2. Set your domain in two files

- `Caddyfile` — replace `arranger.gwo.me` with your domain.
- `docker-compose.prod.yml` — set `ORIGIN: https://your-domain.com` on the `web` service.

### 3. Create the prod env file

Run `cp .env.prod.example .env.prod` and fill in the necessary env variables.

### 4. First deploy

```sh
# build images and start the stack (run from your laptop)
docker --context myserver compose -f docker-compose.prod.yml up -d --build

# verify TLS — issuance is async (a few seconds, up to ~30s after startup);
# follow the log and wait for "certificate obtained successfully" (Ctrl-C to stop)
docker --context myserver compose -f docker-compose.prod.yml logs -f caddy

# create/update the database tables — first deploy, and whenever the schema changes
docker --context myserver compose -f docker-compose.prod.yml --profile tools run --build --rm migrate
```

Then open `https://your-domain.com` — the app should be running, served over a valid cert.

### 5. Operate & update

```sh
# ship updates: re-run the deploy command — Compose rebuilds only what changed
docker --context myserver compose -f docker-compose.prod.yml up -d --build

# tail logs (swap web for caddy or db)
docker --context myserver compose -f docker-compose.prod.yml logs -f web

# reclaim disk — build cache accumulates and can fill the VPS
docker --context myserver system prune -f

# stop and remove the containers (named volumes — DB data — persist)
docker --context myserver compose -f docker-compose.prod.yml down
```