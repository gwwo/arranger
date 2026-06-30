<script lang="ts">
  import { Cooldown, FormState, oauthPopup } from "./utils.svelte";
  import { api, type Banner, type OtpOriginator } from "./types";

  type Props = {
    form: FormState;
    banner: Banner;
    loadMe: (opts?: { newUser?: boolean }) => Promise<boolean>;
    setOtp: (otp: OtpOriginator | null) => void;
    // Owned by UserPanel so they survive the OtpProceed detour — on a sign-up,
    // the form remounts already populated rather than flashing empty fields.
    email: string;
    password: string;
  };
  let {
    form,
    banner = $bindable(),
    loadMe,
    setOtp,
    email = $bindable(""),
    password = $bindable(""),
  }: Props = $props();

  let forgot = $state(false);
  let showPassword = $state(false);

  const RESET_COOLDOWN_S = 30;
  const resetCd = new Cooldown();

  function flash(kind: "info" | "error", text: string) {
    banner = { kind, text };
  }

  async function submitUnsignedIn(e: SubmitEvent) {
    e.preventDefault();
    banner = null;
    if (forgot) {
      if (!resetCd.cool) return;
      await form.wrap(() => api("reset-request", { email }));
      resetCd.start(RESET_COOLDOWN_S);
      flash("info", "If that email exists, a reset link was sent — check your spam folder if you don't see it.");
      return;
    }
    await form.wrap(async () => {
      const r = await api("sign-in", { email, password });
      if (!r.ok) {
        flash("error", r.data?.message ?? "Sign-in failed");
        return;
      }
      if (r.data.shape === "session") {
        await loadMe();
        password = "";
        flash("info", "Signed in.");
        return;
      }
      if (r.data.shape === "signup-otp") {
        setOtp({
          actorToken: r.data.actorToken,
          otp: r.data.otp,
          email: r.data.email,
          type: "signup",
          payload: { password },
          headline: `Couldn't sign you in to ${email} — signing you up instead.`,
        });
      }
    });
  }

  async function googleSignIn() {
    const r = await oauthPopup(
      "/auth/api/google/start?intent=sign-in&callbackURL=/auth/oauth-done",
      "googleSignIn",
    );
    if (r.kind === "blocked") return flash("error", "Popup blocked — please allow popups and try again.");
    if (r.kind === "cancelled") return;
    if (r.kind === "error") return flash("error", r.error);
    await loadMe({ newUser: r.newUser });
    flash("info", r.newUser ? "Account created." : "Signed in.");
  }

  async function githubSignIn() {
    const r = await oauthPopup(
      "/auth/api/github/start?intent=sign-in&callbackURL=/auth/oauth-done",
      "githubSignIn",
    );
    if (r.kind === "blocked") return flash("error", "Popup blocked — please allow popups and try again.");
    if (r.kind === "cancelled") return;
    if (r.kind === "error") return flash("error", r.error);
    await loadMe({ newUser: r.newUser });
    flash("info", r.newUser ? "Account created." : "Signed in.");
  }
</script>

<form onsubmit={submitUnsignedIn} class="space-y-3">
    <input
      type="email"
      required
      placeholder="Email"
      bind:value={email}
      class="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
    />
    <div class="relative">
      <input
        type={showPassword ? "text" : "password"}
        required={!forgot}
        disabled={forgot}
        placeholder="Password"
        bind:value={password}
        class="w-full rounded-md border border-neutral-300 py-2 pr-20 pl-3 text-sm disabled:bg-neutral-100"
      />
      {#if forgot}
        <div
          class="pointer-events-none absolute inset-0 flex items-center rounded-md bg-neutral-100 px-3 text-sm text-neutral-400 italic"
        >
          Password forgotten
        </div>
      {/if}
      {#if !forgot && password !== ""}
        <button
          type="button"
          class="absolute inset-y-0 right-2 my-auto text-xs text-neutral-500 underline"
          onclick={() => (showPassword = !showPassword)}
        >
          {showPassword ? "hide" : "show"}
        </button>
      {:else}
        <button
          type="button"
          class="absolute inset-y-0 right-2 my-auto text-xs text-neutral-500 underline"
          onclick={() => { forgot = !forgot; banner = null; }}
        >
          {forgot ? "got it" : "forgot"}
        </button>
      {/if}
    </div>
    <button
      type="submit"
      class="w-full rounded-md bg-neutral-900 py-2 text-sm text-white disabled:opacity-50"
      disabled={form.busy || (forgot && !resetCd.cool)}
    >
      {form.busy ? "…" : forgot ? `Send reset link${resetCd.cool ? "" : ` (${resetCd.remain}s)`}` : "Sign in / up"}
    </button>
  </form>

  <div class="my-4 flex items-center gap-3 text-xs text-neutral-400">
    <span class="h-px flex-1 bg-neutral-200"></span>
    <span>or</span>
    <span class="h-px flex-1 bg-neutral-200"></span>
  </div>

  <button
    type="button"
    class="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 py-2 text-sm disabled:opacity-50"
    disabled={form.busy}
    onclick={googleSignIn}
  >
    <span class="icon-[logos--google-icon] size-4 shrink-0" aria-hidden="true"></span>
    Continue with Google
  </button>
  <button
    type="button"
    class="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 py-2 text-sm disabled:opacity-50"
    disabled={form.busy}
    onclick={githubSignIn}
  >
    <span class="icon-[logos--github-icon] size-4 shrink-0" aria-hidden="true"></span>
    Continue with GitHub
  </button>
