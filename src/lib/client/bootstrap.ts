// The bootstrap state the page `load` prefetches — its shape lives here (not in
// +page.server.ts) so both the server load and the client page can import it
// without a circular reference. Type-only; safe on both sides. The full `load`
// payload type is the generated PageData in ./$types.

import type { ProjListDelta, ProjDelta, PlacementDelta } from "$lib/server/sync/types";

export type BootstrapState = {
  projList: ProjListDelta;
  // Content for the projects the open panels were showing — active OR drilled
  // into from archive/trash; everything else is fetched lazily on the client.
  projContents: Record<string, ProjDelta>;
  // For prefetched projects that aren't in the active list, where they live, so
  // the client renders them as a placement drill-in ("Back to Archive/Trash").
  projPlacements: Record<string, "archive" | "trash">;
  // Null when the placement view wasn't open (so wasn't prefetched).
  inbox: PlacementDelta | null;
  archive: PlacementDelta | null;
  trash: PlacementDelta | null;
};
