
// ─── Client sync mental model ────────────────────────────────────────────────
//
// The client does not hold a full replica of server state. It fetches on demand
// and caches. Cache entries can be cleared when space is needed.
//
// projList — always maintained: projId + name only, with its own syncedAtSeq.
// proj     — fetched and cached at the project level (rows + checks). Eviction
//            loses the project's syncedAtSeq; next open triggers a full pull.
//
// ─── Cache eviction policy ───────────────────────────────────────────────────
//
// A cache region is evictable only when doing so does not disrupt the user's
// ability to view pending mutations in their context. For example: if new
// archivals are pending for push, the first page of the archive (where they will land)
// must be retained, but further cached pages that contain no pending mutations
// can be cleared freely.
//
// ─── Mutation overlay ────────────────────────────────────────────────────────
//
// Mutations are tracked as a flat overlay (latest value per field per entity),
// independent of the cache. The overlay is the source of push payloads; the
// cache is the source for rendering. The UI renders:
//   mutations[entity][field] ?? cache[entity][field]
//
// One push in-flight at a time. While a push is in-flight, further mutations
// continue accumulating in the overlay.
//
// When the in-flight push acks:
//   1. Advance the relevant cache entries with the server delta.
//   2. Advance syncedAtSeq for each affected scope.
//   3. Clear the overlay entries that were applied in the push (by pushSeq).
//   4. If the overlay still has mutations, compose and dispatch the next push.
//
// On network error: retry the exact same serialised payload — do not recompose.
// Further mutations continue accumulating in the overlay during retries.
//
// Composition is deferred until dispatch time so that syncedAtSeq and
// positional context are always current.
//
// pushSeq — a client-local monotonic counter, incremented each time a push is
// dispatched. Each mutation in the overlay is stamped with the current pushSeq,
// so reconcile knows which overlay entries have been confirmed and can be cleared.
