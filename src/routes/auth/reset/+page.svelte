<script lang="ts">
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import PasswordInput from "$lib/components/user-panel/PasswordInput.svelte";

  type Phase =
    | { kind: "loading" }
    | { kind: "invalid" }
    | { kind: "loaded"; email: string }
    | { kind: "done" };

  const ct = $derived(page.url.searchParams.get("ct") ?? "");
  let phase: Phase = $state({ kind: "loading" });
  let pw = $state("");
  let busy = $state(false);
  let error: string | null = $state(null);

  async function load() {
    if (!ct) {
      phase = { kind: "invalid" };
      return;
    }
    const r = await fetch(`/auth/api/reset-destination?ct=${encodeURIComponent(ct)}`);
    const data = await r.json();
    if (data.status === "invalid" || data.type !== "reset") phase = { kind: "invalid" };
    else phase = { kind: "loaded", email: data.email };
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      const r = await fetch("/auth/api/reset-submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ controllerToken: ct, newPassword: pw }),
      });
      const data = await r.json();
      if (!r.ok) {
        error = data?.message ?? "Could not reset password";
        return;
      }
      phase = { kind: "done" };
      setTimeout(() => goto("/"), 1000);
    } finally {
      busy = false;
    }
  }

  onMount(load);
</script>

<div class="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
  <div class="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
    {#if phase.kind === "loading"}
      <p class="text-sm text-neutral-500">Loading…</p>
    {:else if phase.kind === "invalid"}
      <h1 class="mb-2 text-lg font-semibold">Link invalid or expired</h1>
      <p class="text-sm text-neutral-600">Request a new reset email.</p>
    {:else if phase.kind === "done"}
      <h1 class="mb-2 text-lg font-semibold">Password updated</h1>
      <p class="text-sm text-neutral-600">Redirecting…</p>
    {:else}
      <h1 class="mb-1 text-lg font-semibold">Set a new password</h1>
      <p class="mb-4 text-xs break-all text-neutral-500">{phase.email}</p>
      <form onsubmit={submit} class="space-y-3">
        <PasswordInput
          required
          minlength={8}
          placeholder="New password (min 8)"
          bind:value={pw}
        />
        {#if error}<p class="text-sm text-red-600">{error}</p>{/if}
        <button
          type="submit"
          class="w-full rounded-md bg-neutral-900 py-2 text-sm text-white disabled:opacity-50"
          disabled={busy}
        >
          {busy ? "…" : "Update password"}
        </button>
      </form>
    {/if}
  </div>
</div>
