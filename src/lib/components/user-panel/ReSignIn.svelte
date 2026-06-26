<script lang="ts">
  import { FormState, oauthPopup } from "./utils.svelte";
  import { api, type Me, type Banner, type SessionStatus } from "./types";
  import PasswordInput from "./PasswordInput.svelte";

  type Props = {
    me: Me;
    form: FormState;
    banner: Banner;
    sessionStatus: SessionStatus;
    loadMe: (opts?: { newUser?: boolean }) => Promise<boolean>;
    onResolved: () => void;
  };
  let { me, form, banner = $bindable(), sessionStatus, loadMe, onResolved }: Props = $props();

  let password = $state("");

  function flash(kind: "info" | "error", text: string) {
    banner = { kind, text };
  }

  const hasPasswordCred = $derived(me.credentials.some((c) => c.providerId === "password"));
  const hasGoogleCred = $derived(me.credentials.some((c) => c.providerId === "google"));
  const hasGithubCred = $derived(me.credentials.some((c) => c.providerId === "github"));

  async function doPassword(e: SubmitEvent) {
    e.preventDefault();
    const r = await form.wrap(() => api("re-sign-in", { password, expectedUserId: me.user?.id }));
    if (!r.ok) return flash("error", r.data?.message ?? "Failed");
    password = "";
    await loadMe();
    onResolved();
  }

  const GOOGLE_RESIGN_ERRORS: Record<string, string> = {
    "resign-user-mismatch": "That Google account isn't linked to this account.",
    "resign-no-uid": "Couldn't start Google re-sign-in — please try again.",
  };
  const GITHUB_RESIGN_ERRORS: Record<string, string> = {
    "resign-user-mismatch": "That GitHub account isn't linked to this account.",
    "resign-no-uid": "Couldn't start GitHub re-sign-in — please try again.",
  };

  async function doGithub() {
    const uid = me.user?.id;
    if (!uid) return;
    const r = await oauthPopup(
      `/auth/api/github/start?intent=re-sign-in&uid=${encodeURIComponent(uid)}&callbackURL=/auth/oauth-done`,
      "githubResign",
    );
    if (r.kind === "blocked") return flash("error", "Popup blocked — please allow popups and try again.");
    if (r.kind === "cancelled") return;
    if (r.kind === "error") return flash("error", GITHUB_RESIGN_ERRORS[r.error] ?? r.error);
    await loadMe();
    onResolved();
  }

  async function doGoogle() {
    const uid = me.user?.id;
    if (!uid) return;
    const r = await oauthPopup(
      `/auth/api/google/start?intent=re-sign-in&uid=${encodeURIComponent(uid)}&callbackURL=/auth/oauth-done`,
      "googleResign",
    );
    if (r.kind === "blocked") return flash("error", "Popup blocked — please allow popups and try again.");
    if (r.kind === "cancelled") return;
    if (r.kind === "error") return flash("error", GOOGLE_RESIGN_ERRORS[r.error] ?? r.error);
    await loadMe();
    onResolved();
  }
</script>

<div class="space-y-3">

  {#if hasPasswordCred}
    <form onsubmit={doPassword} class="space-y-2">
      <p class="text-xs break-all text-neutral-500">{me.user?.email}</p>
      <PasswordInput required placeholder="Password" bind:value={password} />
      <button
        type="submit"
        class="w-full rounded-md bg-neutral-900 py-2 text-sm text-white disabled:opacity-50"
        disabled={form.busy}
      >
        {form.busy ? "…" : "Re-sign in with password"}
      </button>
    </form>
  {/if}

  {#if hasPasswordCred && (hasGoogleCred || hasGithubCred)}
    <div class="flex items-center gap-3 text-xs text-neutral-400">
      <span class="h-px flex-1 bg-neutral-200"></span>
      <span>or</span>
      <span class="h-px flex-1 bg-neutral-200"></span>
    </div>
  {/if}

  {#if hasGoogleCred}
    <button
      type="button"
      class="w-full rounded-md border border-neutral-300 py-2 text-sm disabled:opacity-50"
      disabled={form.busy}
      onclick={doGoogle}
    >
      Continue with Google
    </button>
  {/if}

  {#if hasGithubCred}
    <button
      type="button"
      class="w-full rounded-md border border-neutral-300 py-2 text-sm disabled:opacity-50"
      disabled={form.busy}
      onclick={doGithub}
    >
      Continue with GitHub
    </button>
  {/if}
</div>
