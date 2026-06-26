<script lang="ts">
  import { onMount } from "svelte";

  onMount(() => {
    const u = new URL(location.href);
    const error = u.searchParams.get("error");
    const newUser = u.searchParams.get("new") === "1";
    const msg = error
      ? { type: "oauth-done", ok: false, error }
      : { type: "oauth-done", ok: true, newUser };
    if (window.opener) {
      try {
        window.opener.postMessage(msg, location.origin);
      } catch {}
    }
    setTimeout(() => window.close(), 50);
  });
</script>

<div class="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
  <p class="text-sm text-neutral-500">You can close this window.</p>
</div>
