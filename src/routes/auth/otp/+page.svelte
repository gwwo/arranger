<script lang="ts">
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  type Phase =
    | { kind: "invalid" }
    | { kind: "verified"; email: string }
    | { kind: "loaded"; email: string; attemptsLeft: number }
    | { kind: "wrong"; email: string; attemptsLeft: number }
    | { kind: "exhausted" };

  // The OTP destination is resolved server-side (see +page.server.ts); map it to
  // the initial phase so the form is server-rendered. `refresh()` re-derives the
  // phase from the same shape when re-validating client-side.
  const destToPhase = (d: PageData["dest"]): Phase =>
    d.status === "invalid"
      ? { kind: "invalid" }
      : d.status === "verified"
        ? { kind: "verified", email: d.email }
        : { kind: "loaded", email: d.email, attemptsLeft: d.attemptsLeft };

  const vt = $derived(page.url.searchParams.get("vt") ?? "");
  let phase: Phase = $state(destToPhase(data.dest));
  let code = $state("");
  let busy = $state(false);

  // The form is server-rendered, but its submit handler only attaches at
  // hydration. Keep the button disabled (with a "Loading…" affordance) until
  // then, so the form reads as not-yet-ready rather than looking submittable.
  let hydrated = $state(false);

  async function refresh() {
    if (!vt) {
      phase = { kind: "invalid" };
      return;
    }
    try {
      const r = await fetch(`/auth/api/otp-destination?vt=${encodeURIComponent(vt)}`);
      if (!r.ok) throw new Error(`${r.status}`);
      phase = destToPhase(await r.json());
    } catch {
      phase = { kind: "invalid" };
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    try {
      const r = await fetch("/auth/api/otp-attempt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verifierToken: vt, otp: code }),
      });
      const data = await r.json();
      if (data.ok) {
        const email = phase.kind === "loaded" || phase.kind === "wrong" ? phase.email : "";
        phase = { kind: "verified", email };
        code = "";
      } else if (data.error === "WRONG_CODE") {
        const email = phase.kind === "loaded" || phase.kind === "wrong" ? phase.email : "";
        phase = { kind: "wrong", email, attemptsLeft: data.attemptsLeft };
      } else if (data.error === "TOO_MANY_ATTEMPTS") {
        phase = { kind: "exhausted" };
      } else {
        phase = { kind: "invalid" };
      }
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    hydrated = true;
    // The phase is server-rendered on first load. iOS Safari can restore this
    // tab from bfcache (back-forward cache) without re-running the server load,
    // so re-validate the token on a persisted pageshow to catch a code that has
    // since been used or expired.
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) refresh(); };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  });
</script>

<div class="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
  <div class="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
    {#if phase.kind === "invalid"}
      <h1 class="mb-2 text-lg font-semibold">Link invalid or expired</h1>
      <p class="text-sm text-neutral-600">Launch a new one from the originating tab.</p>
    {:else if phase.kind === "verified"}
      <h1 class="mb-2 text-lg font-semibold">Verified</h1>
      <p class="text-sm text-neutral-600">
        You can return to the tab where you started this and click <span class="font-medium">Proceed</span>.
      </p>
      {#if phase.email}
        <p class="mt-2 text-xs break-all text-neutral-500">{phase.email}</p>
      {/if}
    {:else if phase.kind === "exhausted"}
      <h1 class="mb-2 text-lg font-semibold">Too many attempts</h1>
      <p class="text-sm text-neutral-600">Get a new code from the originating tab.</p>
    {:else}
      <h1 class="mb-1 text-lg font-semibold">Enter the code</h1>
      <p class="mb-4 text-xs break-all text-neutral-500">{phase.email}</p>
      <form onsubmit={submit} class="space-y-3">
        <input
          inputmode="numeric"
          pattern={"[0-9]{4}"}
          maxlength="4"
          required
          placeholder="0000"
          bind:value={code}
          class="w-full rounded-md border border-neutral-300 px-3 py-2 text-center text-xl tracking-[0.5em] tabular-nums"
        />
        {#if phase.kind === "wrong"}
          <p class="text-sm text-red-600">
            Wrong code. {phase.attemptsLeft} attempt{phase.attemptsLeft === 1 ? "" : "s"} left.
          </p>
        {/if}
        <button
          type="submit"
          class="flex w-full items-center justify-center gap-2 rounded-md bg-neutral-900 py-2 text-sm text-white disabled:opacity-50"
          disabled={busy || !hydrated || code.length !== 4}
        >
          {#if !hydrated}
            <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
            </svg>
            Loading…
          {:else if busy}
            …
          {:else}
            Verify
          {/if}
        </button>
      </form>
    {/if}
  </div>
</div>
