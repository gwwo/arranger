<script lang="ts" module>
  // The account button (useOpenAccountPanel) destroys and recreates the
  // panel every click, so anything we want to survive a remount has to
  // live at module scope — otherwise the user sees a "Loading…" flash
  // before the cached account reappears. Anchor/invalidKind/lastReported
  // also belong here so the anchor identity doesn't reset on remount.
  //
  // This module state is shared across requests on the server, but `me` carries
  // the requesting user's own info (same as the SSR'd project data) — so it's
  // seeded synchronously per render from request-scoped `data.me` (see seedMe);
  // SSR renders are serialized and don't yield, so one request's `me` can't leak
  // into another's render.
  import { browser } from "$app/environment";
  import type { Me } from "./types";

  let me: Me = $state({ user: null, credentials: [], sessionFresh: false });
  let firstLoadDone = $state(false);
  let anchorUserId: string | null = null;
  let invalidKind: "overwritten" | "invalid" | null = $state(null);
  let lastReportedUserId: string | null = null;
  let inflight: Promise<boolean> | null = null;
  let authChangeHandler:
    | ((userId: string | null, opts?: { newUser?: boolean }) => void)
    | null = null;

  // Seeded with the `me` shape +page.server.ts computed alongside the initial
  // pull, so the account panel renders the cached account immediately (server-
  // side and on first open) instead of flashing "Loading…".
  //
  // On the client this runs once — the `firstLoadDone` guard then preserves the
  // cached `me` across panel remounts (and won't clobber a freshly fetched one).
  // On the server the guard is bypassed so every request re-seeds with its own
  // `data.me` before the panel renders: this module is shared between requests,
  // and a render must not inherit a previous request's user. Safe because SSR
  // renders are synchronous and serialized — the seed and the render that reads
  // it can't be interleaved by another request.
  export function seedMe(initial: Me) {
    if (firstLoadDone && browser) return;
    me = initial;
    firstLoadDone = true;
    anchorUserId = initial.user?.id ?? null;
    lastReportedUserId = anchorUserId;
  }

  function reportAuth(next: string | null, opts?: { newUser?: boolean }) {
    if (next === lastReportedUserId) return;
    lastReportedUserId = next;
    authChangeHandler?.(next, opts);
  }

  // `opts.newUser`: caller knows this load is observing a session for an
  // account that was *just* created by this same client (signup OTP, or
  // Google sign-in that minted a user). Forwarded to onAuthChange so the SPA
  // can preserve the current demo state and upload it instead of pulling.
  // Returns true when the pinned user is still the ambient session user
  // (or there was no anchor yet), false when the session is overwritten or
  // invalid. Callers that don't use the return value are unaffected.
  export function isPinnedUserBlocked(): boolean {
    return invalidKind === "invalid" || invalidKind === "overwritten";
  }

  export async function loadMe(opts?: { newUser?: boolean }): Promise<boolean> {
    if (inflight) return inflight;
    const p: Promise<boolean> = (async () => {
      const r = await fetch("/auth/api/me");
      const next: Me = await r.json();
      firstLoadDone = true;
      if (anchorUserId === null) {
        me = next;
        anchorUserId = next.user?.id ?? null;
        reportAuth(anchorUserId, opts);
        return true;
      }
      if (next.user && next.user.id === anchorUserId) {
        me = next;
        invalidKind = null;
        return true;
      } else if (next.user) {
        invalidKind = "overwritten";
        return false;
      } else {
        invalidKind = "invalid";
        return false;
      }
    })();
    inflight = p;
    try {
      return await p;
    } finally {
      if (inflight === p) inflight = null;
    }
  }

  function setMe(next: Me) {
    me = next;
    const nextId = next.user?.id ?? null;
    anchorUserId = nextId;
    invalidKind = null;
    reportAuth(nextId);
  }

  function markSessionInvalid() {
    invalidKind = "invalid";
  }
</script>

<script lang="ts">
  // Panel-flavored auth UI. Same logic as the original /user/+page.svelte —
  // anchors to the first signed-in user it observes, refuses to silently
  // adopt a different user the cookie has since been swapped to. Fires
  // `onAuthChange` when the SPA's signed-in user identity changes (null ↔ id).
  import { onMount } from "svelte";
  import { FormState } from "./utils.svelte";
  import type { Banner, OtpOriginator, SessionStatus } from "./types";
  import OtpProceed from "./OtpProceed.svelte";
  import UserView from "./UserView.svelte";
  import Welcome from "./Welcome.svelte";
  import ActionRow from "./ActionRow.svelte";

  type Props = {
    // Fires when the anchored signed-in user changes: `userId | null`.
    // Use to (re)pull data, swap demo state, etc.
    onAuthChange?: (userId: string | null) => void;
    topBarHeight?: number;
  };

  let { onAuthChange, topBarHeight = 0 }: Props = $props();
  $effect(() => {
    authChangeHandler = onAuthChange ?? null;
  });

  let scrollEl: HTMLDivElement | null = $state(null);
  let banner: Banner = $state(null);
  let otp: OtpOriginator | null = $state(null);
  let userAnyExpanded = $state(false);
  let welcomeExpanded = $state(true);
  const anyExpanded = $derived(!me.user ? welcomeExpanded : userAnyExpanded);
  const form = new FormState();

  const sessionStatus: SessionStatus = $derived(
    invalidKind ?? (me.sessionFresh ? "fresh" : "stale"),
  );

  function setOtp(next: OtpOriginator | null) {
    otp = next;
  }

  onMount(async () => {
    const u = new URL(location.href);
    const err = u.searchParams.get("error");
    if (err) {
      banner = { kind: "error", text: err };
      u.searchParams.delete("error");
      history.replaceState(null, "", u.toString());
    }
    // Always refresh on mount. The "Loading…" placeholder only shows the
    // first time — subsequent mounts render the cached `me` immediately
    // while loadMe() runs in the background.
    await loadMe();
  });
</script>

<div class={["relative flex size-full flex-col transition-[background-color]", anyExpanded ? "bg-[#f5f5f7]" : "bg-white"]} style:padding-top="{topBarHeight}px">
  <div bind:this={scrollEl} class="relative flex-1 overflow-y-auto px-4 pb-8">
    {#if !firstLoadDone}
      <div class="flex min-h-full items-center justify-center">
        <p class="text-sm text-neutral-500">Loading…</p>
      </div>
    {:else if me.user}
      <UserView
        {me}
        {form}
        bind:banner
        {loadMe}
        {otp}
        {setOtp}
        {setMe}
        {sessionStatus}
        {markSessionInvalid}
        bind:anyExpanded={userAnyExpanded}
        scrollContainer={scrollEl}
      />
    {:else}
      <div class="mx-4 pt-7.5">
        <p class="text-2xl font-semibold text-neutral-700 wrap-break-word min-h-lh">Welcome</p>
      </div>
      <div class={["mt-4 mx-4 min-h-12 text-sm wrap-break-word", banner?.kind === "error" ? "text-red-700" : "text-emerald-700"]}>
        {banner?.text ?? "Great to see you here."}
      </div>
      <div style:margin-top="{welcomeExpanded ? 30 : 20}px" class="trans-margin">
        <ActionRow
          expanded={welcomeExpanded}
          onclick={() => {
            if (welcomeExpanded) {
              welcomeExpanded = false;
            } else {
              banner = null;
              welcomeExpanded = true;
            }
          }}
        >
          {#snippet label()}Sync your todos with an account{/snippet}
          {#snippet expandedContent()}
            {#if otp}
              <OtpProceed {otp} {form} bind:banner {loadMe} {setOtp} />
            {:else}
              <Welcome {form} bind:banner {loadMe} {setOtp} />
            {/if}
          {/snippet}
        </ActionRow>
      </div>
    {/if}
  </div>
</div>

<style>
  .trans-margin {
    transition: margin-top 300ms ease;
  }
</style>
