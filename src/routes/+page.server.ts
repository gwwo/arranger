import type { PageServerLoad } from "./$types";
import { ensureDataUser } from "$lib/server/sync-apply";
import { buildProjListDelta, buildProjDelta, buildPlacementDelta, getProjPlacement } from "$lib/server/sync/pull-handler";
import type { ProjListDelta, ProjDelta, PlacementDelta } from "$lib/server/sync/types";
import { listUserCreds, isSessionFresh } from "$lib/server/user-auth";
import type { Me } from "$lib/components/user-panel/types";
import { OPEN_SCOPES_COOKIE, parseOpenScopes } from "$lib/client/open-scopes";
import type { PlacementName } from "$lib/client/model";

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

export const load: PageServerLoad = async ({ locals, cookies }) => {
  const s = locals.user;
  if (!s) {
    return {
      state: null as BootstrapState | null,
      user: null,
      me: { user: null, credentials: [], sessionFresh: false } as Me,
    };
  }

  await ensureDataUser(s.user.id);

  const [projList, creds] = await Promise.all([
    buildProjListDelta(s.user.id, undefined),
    listUserCreds(s.user.id),
  ]);

  // Prefetch only the scopes the open panels were showing (from the cookie the
  // client keeps in sync with its panels). With no cookie — first ever visit —
  // default to the first active project, which the default main panel opens.
  const open = parseOpenScopes(cookies.get(OPEN_SCOPES_COOKIE));
  const wantProjects = open
    ? open.projects
    : projList.projects[0]
      ? [projList.projects[0].id]
      : [];
  const wantPlacements = new Set<PlacementName>(open?.placements ?? []);

  const loadPlacement = (p: PlacementName): Promise<PlacementDelta | null> =>
    wantPlacements.has(p) ? buildPlacementDelta(s.user.id, p) : Promise.resolve(null);

  // Fetch each wanted project's content + where it lives. A project not in the
  // active list is a drill-in from archive/trash; one that no longer exists
  // (stale cookie) is skipped.
  const projContents: Record<string, ProjDelta> = {};
  const projPlacements: Record<string, "archive" | "trash"> = {};
  const [, inbox, archive, trash] = await Promise.all([
    Promise.all(
      wantProjects.map(async (id) => {
        const [delta, placement] = await Promise.all([
          buildProjDelta(s.user.id, id, undefined),
          getProjPlacement(s.user.id, id),
        ]);
        if (placement == null) return;
        projContents[id] = delta;
        if (placement !== "list") projPlacements[id] = placement;
      }),
    ),
    loadPlacement("inbox"),
    loadPlacement("archive"),
    loadPlacement("trash"),
  ]);

  const state: BootstrapState = { projList, projContents, projPlacements, inbox, archive, trash };

  const me: Me = {
    user: {
      id: s.user.id,
      name: s.user.name,
      email: s.user.email,
      resetDisabled: s.user.resetDisabled,
    },
    credentials: creds.map((c) => ({
      providerId: c.providerId,
      accountId: c.accountId,
      email: c.providerId === "password" ? s.user.email : c.email,
    })),
    sessionFresh: isSessionFresh(s.session),
  };

  return {
    state,
    user: { id: s.user.id, name: s.user.name, email: s.user.email },
    me,
  };
};
