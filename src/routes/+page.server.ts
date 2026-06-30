import type { PageServerLoad } from "./$types";
import { ensureDataUser } from "$lib/server/sync-apply";
import { buildProjListDelta, buildProjDelta, buildPlacementDelta, getProjPlacement } from "$lib/server/sync/pull-handler";
import type { PlacementDelta, ProjDelta } from "$lib/server/sync/types";
import { listUserCreds, isSessionFresh } from "$lib/server/user-auth";
import type { Me } from "$lib/components/user-panel/types";
import { PANEL_COMP_COOKIE, parsePanelComp, scopesOf } from "$lib/client/panel-comp";
import type { PlacementName } from "$lib/client/model";
import type { BootstrapState } from "$lib/client/bootstrap";

export const load: PageServerLoad = async ({ locals, cookies }) => {
  const s = locals.user;
  if (!s) {
    return {
      state: null as BootstrapState | null,
      user: null,
      me: { user: null, credentials: [], sessionFresh: false } as Me,
      panels: null,
    };
  }

  await ensureDataUser(s.user.id);

  const [projList, creds] = await Promise.all([
    buildProjListDelta(s.user.id, undefined),
    listUserCreds(s.user.id),
  ]);

  // Prefetch only the scopes the open panels were showing (from the panel_comp
  // cookie the client keeps in sync with its panels). With no cookie — first ever
  // visit — default to the first active project, which the default main panel opens.
  const comp = parsePanelComp(cookies.get(PANEL_COMP_COOKIE));
  const scopes = comp ? scopesOf(comp) : null;
  const wantProjects = scopes
    ? scopes.projects
    : projList.projects[0]
      ? [projList.projects[0].id]
      : [];
  const wantPlacements = new Set<PlacementName>(scopes?.placements ?? []);

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
    // Echo the parsed composition back so the page builds the same panels the
    // server prefetched for, server-side render and client hydration agreeing.
    panels: comp,
  };
};
