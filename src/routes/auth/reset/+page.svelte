<script lang="ts">
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import PasswordInput from "$lib/components/user-panel/PasswordInput.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  type Phase =
    | { kind: "invalid" }
    | { kind: "loaded"; email: string }
    | { kind: "done" };

  // The controller token is resolved server-side (see +page.server.ts) so the
  // new-password form is server-rendered rather than appearing after a fetch.
  const ct = $derived(page.url.searchParams.get("ct") ?? "");
  let phase: Phase = $state(
    data.dest.status === "loaded"
      ? { kind: "loaded", email: data.dest.email }
      : { kind: "invalid" },
  );
  let pw = $state("");
  let busy = $state(false);
  let error: string | null = $state(null);

  // The form is server-rendered, but its submit handler only attaches at
  // hydration; a click before then would trigger a native (handler-less) form
  // submit. Keep the button disabled until hydration so the form is inert while
  // it can't actually work — onMount runs only on the client, post-hydration.
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

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
      setTimeout(() => goto(resolve("/")), 1000);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
  <div class="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
    {#if phase.kind === "invalid"}
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
          class="flex w-full items-center justify-center gap-2 rounded-md bg-neutral-900 py-2 text-sm text-white disabled:opacity-50"
          disabled={busy || !hydrated}
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
            Update password
          {/if}
        </button>
      </form>
    {/if}
  </div>
</div>
