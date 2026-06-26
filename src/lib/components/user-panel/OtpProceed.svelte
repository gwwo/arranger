<script lang="ts">
  import { Cooldown, FormState } from "./utils.svelte";
  import { api, type OtpOriginator, type Banner } from "./types";

  type Props = {
    otp: OtpOriginator;
    form: FormState;
    banner: Banner;
    loadMe: (opts?: { newUser?: boolean }) => Promise<boolean>;
    setOtp: (otp: OtpOriginator | null) => void;
  };
  let {
    otp,
    form,
    banner = $bindable(),
    loadMe,
    setOtp,
  }: Props = $props();

  const COOLDOWN_S = 30;
  const PROCEED_COOLDOWN_S = 5;
  const rotateCd = new Cooldown();
  const proceedCd = new Cooldown();

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyOtp() {
    try {
      await navigator.clipboard.writeText(otp.otp);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1500);
    } catch {
      flash("error", "Could not copy.");
    }
  }

  function flash(kind: "info" | "error", text: string) {
    banner = { kind, text };
  }

  async function otpRotate() {
    if (!rotateCd.cool) return;
    const r = await form.wrap(() => api("otp-rotate", { actorToken: otp.actorToken }));
    if (!r.ok) return;
    const kind = r.data?.kind;
    if (kind === "too_frequent") {
      rotateCd.start(Math.ceil((r.data.retryAfterMs ?? COOLDOWN_S * 1000) / 1000));
      flash("error", `Too frequent — wait ${rotateCd.remain}s.`);
      return;
    }
    rotateCd.start(COOLDOWN_S);
    if (kind === "ok") {
      setOtp({ ...otp, otp: r.data.otp });
    } else if (kind === "verified") {
      flash("info", "Already verified — press Proceed.");
    } else if (kind === "expired") {
      setOtp(null);
      flash("error", "Expired — please start over.");
    }
  }

  async function otpCancel() {
    await form.wrap(() => api("otp-cancel", { actorToken: otp.actorToken }));
    setOtp(null);
  }

  async function otpProceed() {
    if (!proceedCd.cool) return;
    const r = await form.wrap(() =>
      api("otp-proceed", {
        actorToken: otp.actorToken,
        ...(otp.payload ?? {}),
      }),
    );
    if (!r.ok) {
      proceedCd.start(PROCEED_COOLDOWN_S);
      flash("error", "Verification failed.");
      return;
    }
    const shape = r.data?.shape;
    if (shape === "too_frequent") {
      proceedCd.start(Math.ceil((r.data.retryAfterMs ?? PROCEED_COOLDOWN_S * 1000) / 1000));
      flash("error", `Too frequent — wait ${proceedCd.remain}s.`);
      return;
    }
    proceedCd.start(PROCEED_COOLDOWN_S);
    if (shape === "session") {
      setOtp(null);
      await loadMe({ newUser: !!r.data?.newUser });
      flash("info", "Account created and signed in.");
    } else if (shape === "ok") {
      setOtp(null);
      await loadMe();
      flash("info", "Done.");
    } else if (shape === "expired") {
      setOtp(null);
      flash("error", "Expired — please start over.");
    } else {
      flash("error", "Verification failed.");
    }
  }
</script>

<h1 class="mb-2 text-lg font-semibold">Verify {otp.email}</h1>
<p class="mb-4 text-sm text-neutral-600">{otp.headline}</p>
<p class="mb-2 text-xs text-neutral-500">
  An email may have been sent (check your spam folder if needed). Click the link inside and enter this code:
</p>
<div class="mb-1 flex items-center justify-center gap-2">
  <p class="font-mono text-3xl tracking-[0.5em] tabular-nums">{otp.otp}</p>
  <button
    type="button"
    class="rounded-md border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
    onclick={copyOtp}
  >
    <span class="grid">
      <span class="invisible col-start-1 row-start-1" aria-hidden="true">Copied</span>
      <span class="col-start-1 row-start-1">{copied ? "Copied" : "Copy"}</span>
    </span>
  </button>
</div>
<div class="mb-4 flex justify-center">
  <button
    type="button"
    class="text-xs text-neutral-500 underline disabled:opacity-50"
    disabled={form.busy || !rotateCd.cool}
    onclick={otpRotate}
  >
    Get a new code{rotateCd.cool ? "" : ` (${rotateCd.remain}s)`}
  </button>
</div>
<div class="flex gap-3">
  <button
    type="button"
    class="flex-1 rounded-md border border-neutral-300 py-2 text-xs disabled:opacity-50"
    disabled={form.busy}
    onclick={otpCancel}
  >
    Cancel
  </button>
  <button
    type="button"
    class="flex-3 rounded-md bg-neutral-900 py-2 text-xs text-white disabled:opacity-50"
    disabled={form.busy || !proceedCd.cool}
    onclick={otpProceed}
  >
    I've verified. Proceed{proceedCd.cool ? "" : ` (${proceedCd.remain}s)`}
  </button>
</div>
{#if banner}
  <p class="mt-4 text-sm {banner.kind === 'error' ? 'text-red-600' : 'text-emerald-700'}">
    {banner.text}
  </p>
{/if}
