<script lang="ts">
  import { page } from "$app/state";
  import { onMount } from "svelte";

  type Phase =
    | { kind: "loading" }
    | { kind: "invalid" }
    | { kind: "verified"; email: string }
    | { kind: "loaded"; email: string; attemptsLeft: number }
    | { kind: "wrong"; email: string; attemptsLeft: number }
    | { kind: "exhausted" };

  const vt = $derived(page.url.searchParams.get("vt") ?? "");
  let phase: Phase = $state({ kind: "loading" });
  let code = $state("");
  let busy = $state(false);

  async function load() {
    if (!vt) {
      phase = { kind: "invalid" };
      return;
    }
    try {
      const r = await fetch(`/auth/api/otp-destination?vt=${encodeURIComponent(vt)}`);
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();
      if (data.status === "invalid") phase = { kind: "invalid" };
      else if (data.status === "verified") phase = { kind: "verified", email: data.email };
      else phase = { kind: "loaded", email: data.email, attemptsLeft: data.attemptsLeft };
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
    load();
    // iOS Safari restores pages from bfcache (back-forward cache) without
    // re-running onMount. Re-trigger load so the page doesn't stay frozen
    // in "loading" state when opened from Mail via a cached Safari tab.
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) load(); };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  });
</script>

<div class="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
  <div class="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
    {#if phase.kind === "loading"}
      <p class="text-sm text-neutral-500">Loading…</p>
    {:else if phase.kind === "invalid"}
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
          class="w-full rounded-md bg-neutral-900 py-2 text-sm text-white disabled:opacity-50"
          disabled={busy || code.length !== 4}
        >
          {busy ? "…" : "Verify"}
        </button>
      </form>
    {/if}
  </div>
</div>
