# Stage 1: dev deps
FROM oven/bun:1-slim AS base
WORKDIR /app
RUN apt-get update \
 && apt-get install -y git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY bun.lock package.json ./
RUN bun install

# Stage 2: build
FROM base AS build
COPY src ./src
COPY static ./static
COPY svelte.config.js vite.config.ts tsconfig.json ./
RUN bun run build

# Stage 3: prod deps only
FROM oven/bun:1-slim AS deps
WORKDIR /app
COPY bun.lock package.json ./
RUN bun install --production

# Stage 4: production runtime
FROM oven/bun:1-slim AS run
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/package.json .
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 3000
CMD ["bun", "run", "build/index.js"]