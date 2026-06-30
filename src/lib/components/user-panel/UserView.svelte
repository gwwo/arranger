<script lang="ts">
  import { FormState, oauthPopup } from "./utils.svelte";
  import { api, type Me, type Banner, type OtpOriginator, type SessionStatus } from "./types";
  import ReSignIn from "./ReSignIn.svelte";
  import OtpProceed from "./OtpProceed.svelte";
  import PasswordInput from "./PasswordInput.svelte";
  import ActionRow from "./ActionRow.svelte";
  import SectionHeader from "./SectionHeader.svelte";
  import { Input } from "$lib";
  import { scrollWithCallback } from "$lib/utils/dom";

  type RowKey = Exclude<Action, null> | "reSignIn";

  type Props = {
    me: Me;
    form: FormState;
    banner: Banner;
    otp: OtpOriginator | null;
    loadMe: (opts?: { newUser?: boolean }) => Promise<boolean>;
    setOtp: (otp: OtpOriginator | null) => void;
    setMe: (me: Me) => void;
    sessionStatus: SessionStatus;
    markSessionInvalid: () => void;
    anyExpanded?: boolean;
    scrollContainer?: HTMLDivElement | null;
  };
  let {
    me,
    form,
    banner = $bindable(),
    otp,
    loadMe,
    setOtp,
    setMe,
    sessionStatus,
    markSessionInvalid,
    anyExpanded = $bindable(false),
    scrollContainer = null,
  }: Props = $props();

  type Action =
    | null
    | "change-password-cred"
    | "add-password-cred"
    | "delete-password-cred"
    | "delete-google-cred"
    | "delete-github-cred"
    | "delete-user"
    | "disable-reset"
    | "enable-reset"
    | "link-google"
    | "link-github"
    | "sign-out";
  let action: Action = $state(null);

  const expandedSpacing = 30;
  const expandDuration = 200;
  let rowToReveal: RowKey | null = $state(null);
  let rowRefs: Partial<Record<RowKey, ActionRow | null>> = $state({});

  $effect(() => {
    const container = scrollContainer;
    const key = rowToReveal;
    if (!container || key == null) return;
    setTimeout(() => {
      const ref = rowRefs[key];
      if (!ref) { rowToReveal = null; return; }
      const el = ref.getEl();
      if (!el) { rowToReveal = null; return; }

      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      // The wrapper div above rootEl has `style:margin-top` set by Svelte (the
      // final value) but CSS `transition: margin-top 300ms ease` means the
      // computed style is still at the old value when getBoundingClientRect runs.
      // Correct by the difference so elTop reflects the final layout position.
      const wrapper = el.parentElement;
      const wrapperInlineMargin = parseFloat(wrapper?.style.marginTop ?? "0") || 0;
      const wrapperComputedMargin = wrapper ? parseFloat(getComputedStyle(wrapper).marginTop) : 0;
      const marginCorrection = wrapperInlineMargin - wrapperComputedMargin;
      const elTop = elRect.top - containerRect.top + container.scrollTop + marginCorrection;
      const top = elTop - expandedSpacing;
      const bottom = top + expandedSpacing * 2 + ref.getEndHeight();

      const viewTop = container.scrollTop;
      const viewBottom = container.clientHeight + viewTop;
      if (top >= viewTop && bottom <= viewBottom) {
        rowToReveal = null;
        return;
      }

      const isRowTall = bottom - top >= container.clientHeight;
      const isRowOutsideView = top >= viewBottom || bottom <= viewTop;
      const isRowOverlapsBottom = top < viewBottom && bottom > viewBottom;

      const target = isRowTall
        ? top
        : isRowOutsideView
          ? (top + bottom - container.clientHeight) / 2
          : isRowOverlapsBottom
            ? bottom - container.clientHeight
            : top;

      const maxScrollTopNow = container.scrollHeight - container.clientHeight;
      const delay = target >= maxScrollTopNow ? expandDuration : null;
      scrollWithCallback(container, target, () => { rowToReveal = null; }, expandDuration, delay);
    });
  });
  let reSignInOpen = $state(false);
  let reSignInBlockedByStale = $state(false);
  let curPassword = $state("");
  let newPassword = $state("");
  let newEmail = $state("");
  let confirmPassword = $state("");
  let deleteChecking = $state(false);
  let googleChecking = $state(false);
  let githubChecking = $state(false);
  let googleInfoExpanded = $state(false);
  let githubInfoExpanded = $state(false);

  function flash(kind: "info" | "error", text: string) {
    banner = { kind, text };
  }

  function meApi(op: string, body?: Record<string, unknown>) {
    return api(op, { ...body, expectedUserId: me.user?.id });
  }

  function clearInputs() {
    curPassword = "";
    newPassword = "";
    newEmail = "";
    confirmPassword = "";
  }

  function openAction(a: Action) {
    action = a;
    clearInputs();
    if (a === "change-password-cred") newEmail = me.user?.email ?? "";
    banner = null;
    if (a !== null) rowToReveal = a;
  }

  const toggleAction = (a: Exclude<Action, null>) => () =>
    openAction(action === a ? null : a);

  function intercept401(r: { ok: boolean; status: number }): boolean {
    if (!r.ok && r.status === 401) {
      markSessionInvalid();
      return true;
    }
    return false;
  }

  async function interceptUserMismatch(r: { ok: boolean; status: number }): Promise<boolean> {
    if (!r.ok && r.status === 409) {
      await loadMe();
      return true;
    }
    return false;
  }

  async function interceptStale(r: {
    ok: boolean;
    status: number;
    data: { message?: string } | null;
  }): Promise<boolean> {
    if (!r.ok && r.status === 403 && /fresh/.test(r.data?.message ?? "")) {
      action = null;
      clearInputs();
      reSignInBlockedByStale = true;
      await loadMe();
      return true;
    }
    return false;
  }

  const emailChanged = $derived(
    newEmail.trim().toLowerCase() !== (me.user?.email ?? "").toLowerCase(),
  );
  const credentialChange = $derived(emailChanged || newPassword.length > 0);

  async function setName(name: string) {
    const r = await form.wrap(() => meApi("set-name", { name }));
    if (intercept401(r)) return;
    if (await interceptUserMismatch(r)) return;
    if (!r.ok) return flash("error", r.data?.message ?? "Failed");
    await loadMe();
    flash("info", "Account Label updated.");
  }

  async function doChangePasswordCred(e: SubmitEvent) {
    e.preventDefault();
    const r = await form.wrap(() =>
      meApi("change-password-cred-start", {
        currentPassword: curPassword,
        newEmail,
        newPassword: emailChanged ? undefined : newPassword,
      }),
    );
    if (intercept401(r)) return;
    if (await interceptUserMismatch(r)) return;
    if (!r.ok) return flash("error", r.data?.message ?? "Failed");
    if (r.data.shape === "ok") {
      action = null;
      clearInputs();
      await loadMe();
      flash("info", "Password changed; other sessions revoked.");
      return;
    }
    if (r.data.shape === "otp") {
      setOtp({
        actorToken: r.data.actorToken,
        otp: r.data.otp,
        email: r.data.email,
        type: "change-email",
        payload: newPassword ? { password: newPassword } : undefined,
        headline: newPassword
          ? `Verifying ${r.data.email} as your new correspondent email; password will also be updated.`
          : `Verifying ${r.data.email} as your new correspondent email.`,
      });
      action = null;
      clearInputs();
      await loadMe();
    }
  }

  async function doAddPasswordCredStart(e: SubmitEvent) {
    e.preventDefault();
    const r = await form.wrap(() =>
      meApi("add-password-cred-start", { email: newEmail }),
    );
    if (intercept401(r)) return;
    if (await interceptUserMismatch(r)) return;
    if (!r.ok) return flash("error", r.data?.message ?? "Failed");
    if (r.data.shape === "otp") {
      setOtp({
        actorToken: r.data.actorToken,
        otp: r.data.otp,
        email: r.data.email,
        type: "add-password-cred",
        payload: { password: newPassword },
        headline: `Linking ${r.data.email} as your password credential.`,
      });
      action = null;
      clearInputs();
    }
  }

  async function doDeletePasswordCred(e: SubmitEvent) {
    e.preventDefault();
    const r = await form.wrap(() => meApi("delete-password-cred", { password: confirmPassword }));
    if (intercept401(r)) return;
    if (await interceptUserMismatch(r)) return;
    if (!r.ok) return flash("error", r.data?.message ?? "Failed");
    action = null;
    clearInputs();
    await loadMe();
    flash("info", "Password credential removed.");
  }

  async function startDeleteGithubCred() {
    if (hasPasswordCred) {
      openAction("delete-github-cred");
      return;
    }
    githubChecking = true;
    try {
      await loadMe();
    } catch (e) {
      flash("error", e instanceof Error ? e.message : "Failed to check session");
      return;
    } finally {
      githubChecking = false;
    }
    if (sessionStatus === "fresh") {
      openAction("delete-github-cred");
    } else {
      if (sessionStatus === "stale") reSignInBlockedByStale = true;
    }
  }

  async function doDeleteGithubCred(e: SubmitEvent) {
    e.preventDefault();
    const r = await form.wrap(() =>
      meApi("delete-github-cred", hasPasswordCred ? { password: confirmPassword } : {}),
    );
    if (intercept401(r)) return;
    if (await interceptUserMismatch(r)) return;
    if (await interceptStale(r)) return;
    if (!r.ok) return flash("error", r.data?.message ?? "Failed");
    action = null;
    clearInputs();
    await loadMe();
    flash("info", "GitHub credential removed.");
  }

  async function linkGithub() {
    const startUserId = me.user?.id;
    if (!startUserId) return;
    const r = await oauthPopup(
      "/auth/api/github/start?intent=link&callbackURL=/auth/oauth-done",
      "githubLink",
    );
    if (r.kind === "blocked") return flash("error", "Popup blocked — please allow popups and try again.");
    if (r.kind === "cancelled") return;
    if (r.kind === "error") {
      const msg =
        r.error === "github-already-linked" ? "That GitHub account is already linked to another user." :
        r.error === "link-session-mismatch" ? "Session changed during linking — re-sign in." :
        "Failed to link GitHub.";
      return flash("error", msg);
    }
    await loadMe();
    if (sessionStatus === "overwritten" || sessionStatus === "invalid") {
      return flash("error", "Session changed during linking — re-sign in.");
    }
    flash("info", "GitHub linked.");
  }

  async function startDeleteGoogleCred() {
    if (hasPasswordCred) {
      openAction("delete-google-cred");
      return;
    }
    googleChecking = true;
    try {
      await loadMe();
    } catch (e) {
      flash("error", e instanceof Error ? e.message : "Failed to check session");
      return;
    } finally {
      googleChecking = false;
    }
    if (sessionStatus === "fresh") {
      openAction("delete-google-cred");
    } else {
      if (sessionStatus === "stale") reSignInBlockedByStale = true;
    }
  }

  async function doDeleteGoogleCred(e: SubmitEvent) {
    e.preventDefault();
    const r = await form.wrap(() =>
      meApi("delete-google-cred", hasPasswordCred ? { password: confirmPassword } : {}),
    );
    if (intercept401(r)) return;
    if (await interceptUserMismatch(r)) return;
    if (await interceptStale(r)) return;
    if (!r.ok) return flash("error", r.data?.message ?? "Failed");
    action = null;
    clearInputs();
    await loadMe();
    flash("info", "Google credential removed.");
  }

  async function doDisableReset(e: SubmitEvent) {
    e.preventDefault();
    const r = await form.wrap(() => meApi("disable-reset", { password: confirmPassword }));
    if (intercept401(r)) return;
    if (await interceptUserMismatch(r)) return;
    if (!r.ok) return flash("error", r.data?.message ?? "Failed");
    action = null;
    clearInputs();
    await loadMe();
    flash("info", "Reset-password-via-email disabled.");
  }

  async function doEnableReset() {
    const r = await form.wrap(() => meApi("enable-reset"));
    if (intercept401(r)) return;
    if (await interceptUserMismatch(r)) return;
    if (await interceptStale(r)) return;
    if (!r.ok) return flash("error", r.data?.message ?? "Failed");
    action = null;
    clearInputs();
    await loadMe();
    flash("info", "Reset-password-via-email re-enabled.");
  }

  async function startDeleteUser() {
    if (hasPasswordCred) {
      openAction("delete-user");
      return;
    }
    deleteChecking = true;
    try {
      await loadMe();
    } catch (e) {
      flash("error", e instanceof Error ? e.message : "Failed to check session");
      return;
    } finally {
      deleteChecking = false;
    }
    if (sessionStatus === "fresh") {
      openAction("delete-user");
    } else {
      if (sessionStatus === "stale") reSignInBlockedByStale = true;
    }
  }

  async function doDeleteUser(e: SubmitEvent) {
    e.preventDefault();
    const r = await form.wrap(() =>
      meApi("delete-user", hasPasswordCred ? { password: confirmPassword } : {}),
    );
    if (intercept401(r)) return;
    if (await interceptUserMismatch(r)) return;
    if (await interceptStale(r)) return;
    if (!r.ok) return flash("error", r.data?.message ?? "Failed");
    action = null;
    clearInputs();
    setMe({ user: null, credentials: [], sessionFresh: false });
    setOtp(null);
    flash("info", "Account deleted.");
  }

  async function signOut() {
    await form.wrap(() => api("sign-out", { expectedUserId: me.user?.id }));
    setMe({ user: null, credentials: [], sessionFresh: false });
    setOtp(null);
    flash("info", "Signed out.");
  }

  async function linkGoogle() {
    const startUserId = me.user?.id;
    if (!startUserId) return;
    const r = await oauthPopup(
      "/auth/api/google/start?intent=link&callbackURL=/auth/oauth-done",
      "googleLink",
    );
    if (r.kind === "blocked") return flash("error", "Popup blocked — please allow popups and try again.");
    if (r.kind === "cancelled") return;
    if (r.kind === "error") {
      const msg =
        r.error === "google-already-linked" ? "That Google account is already linked to another user." :
        r.error === "link-session-mismatch" ? "Session changed during linking — re-sign in." :
        "Failed to link Google.";
      return flash("error", msg);
    }
    await loadMe();
    if (sessionStatus === "overwritten" || sessionStatus === "invalid") {
      return flash("error", "Session changed during linking — re-sign in.");
    }
    flash("info", "Google linked.");
  }

  function onReSignInResolved() {
    reSignInOpen = false;
    reSignInBlockedByStale = false;
    flash("info", action !== null ? "Session refreshed — please retry." : "Session refreshed.");
  }

  function onReSignInCancel() {
    reSignInOpen = false;
  }

  $effect(() => {
    anyExpanded = action !== null || reSignInOpen || otp !== null || googleInfoExpanded || githubInfoExpanded;
  });

  $effect(() => {
    if (sessionStatus === "overwritten") {
      banner = { kind: "error", text: "Account overwritten — please re-sign in." };
    } else if (sessionStatus === "invalid") {
      banner = { kind: "error", text: "Session ended — please re-sign in." };
    } else if (sessionStatus === "stale" && reSignInBlockedByStale) {
      banner = { kind: "error", text: "Session stale — please re-sign in." };
    }
  });

  const hasPasswordCred = $derived(
    me.user ? me.credentials.some((c) => c.providerId === "password") : false,
  );
  const hasGoogleCred = $derived(
    me.user ? me.credentials.some((c) => c.providerId === "google") : false,
  );
  const hasGithubCred = $derived(
    me.user ? me.credentials.some((c) => c.providerId === "github") : false,
  );
  // Sign-in methods that could re-enable reset if the password is forgotten.
  const reEnableProviderLabel = $derived(
    [hasGoogleCred && "Google", hasGithubCred && "GitHub"].filter(Boolean).join(" or "),
  );
  const googleCred = $derived(
    me.credentials.find((c) => c.providerId === "google") ?? null,
  );
  const githubCred = $derived(
    me.credentials.find((c) => c.providerId === "github") ?? null,
  );
  const credentialCount = $derived(me.user ? me.credentials.length : 0);

  const showReSignIn = $derived(
    reSignInOpen ||
    sessionStatus === "invalid" ||
    sessionStatus === "overwritten" ||
    (sessionStatus === "stale" && reSignInBlockedByStale),
  );

  const sessionBlocked = $derived(
    sessionStatus === "invalid" || sessionStatus === "overwritten",
  );

  function notOpenBlocked(a: Exclude<Action, null>): boolean {
    return sessionBlocked && action !== a;
  }

  function staleBlocked(a: Exclude<Action, null>): boolean {
    return sessionStatus === "stale" && reSignInBlockedByStale && action !== a;
  }

  // Margins follow TodoList's getMarginTop rules:
  //   head → any:        20px base, 30 if cur expanded
  //   section → action:  10px base, 30 if cur expanded
  //   action → action:    0px base, 30 if either expanded
  //   any → section:     30px always
  type RowKind = "section" | "action";
  type RowId =
    | "reSignIn" | "emailPasswordSection" | "otp" | "resetToggle"
    | "changePasswordCred" | "deletePasswordCred" | "addPasswordCred"
    | "googleSection" | "googleAction" | "githubSection" | "githubAction"
    | "accountSection" | "deleteUser" | "signOut";

  function getMarginTop(
    pre: { kind: RowKind; expanded: boolean } | null,
    cur: { kind: RowKind; expanded: boolean },
  ): number {
    const base =
      pre === null ? 20 :
      cur.kind === "section" ? 30 :
      pre.kind === "section" ? 10 :
      0;
    const anyExpanded = (pre !== null && pre.expanded) || cur.expanded;
    return anyExpanded ? Math.max(30, base) : base;
  }

  const visibleRows = $derived.by(() => {
    type Entry = { id: RowId; kind: RowKind; expanded: boolean };
    const list: Entry[] = [];
    const add = (id: RowId, kind: RowKind, expanded = false) => list.push({ id, kind, expanded });

    if (showReSignIn) add("reSignIn", "action", reSignInOpen);

    add("emailPasswordSection", "section");
    if (otp) {
      add("otp", "action");
    } else if (hasPasswordCred) {
      add("resetToggle", "action", action === "enable-reset" || action === "disable-reset");
      add("changePasswordCred", "action", action === "change-password-cred");
      if (credentialCount > 1) add("deletePasswordCred", "action", action === "delete-password-cred");
    } else {
      add("addPasswordCred", "action", action === "add-password-cred");
    }

    add("googleSection", "section");
    add("googleAction", "action", action === "delete-google-cred" || action === "link-google" || googleInfoExpanded);

    add("githubSection", "section");
    add("githubAction", "action", action === "delete-github-cred" || action === "link-github" || githubInfoExpanded);

    add("accountSection", "section");
    add("deleteUser", "action", action === "delete-user");
    add("signOut", "action", action === "sign-out");

    return list;
  });

  const margins = $derived.by(() => {
    const result = {} as Record<RowId, number>;
    visibleRows.forEach((cur, i) => {
      result[cur.id] = getMarginTop(i === 0 ? null : visibleRows[i - 1], cur);
    });
    return result;
  });
  const bottomSpacerH = 30;
</script>

<!-- Head: editable name + session info chips -->
<div class="mx-4 pt-7.5">
  <Input
    class="text-2xl font-semibold wrap-break-word min-h-lh"
    bind:value={
      () => me.user?.name ?? "",
      (v) => (v !== (me.user?.name ?? "") ? setName(v) : null)
    }
    updateOnBlur
    placeholder="Account Label"
    onkeydown={(e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.currentTarget.blur();
      }
    }}
  ></Input>
</div>

<div class={["mt-4 mx-4 min-h-12 text-sm wrap-break-word", banner?.kind === "error" ? "text-red-700" : "text-emerald-700"]}>
  {banner?.text ?? "Manage your account here."}
</div>

<!-- Re-sign-in: always shown for invalid/overwritten sessions; shown for stale
     only after a blocked action. -->
{#if showReSignIn}
  <div style:margin-top="{margins.reSignIn}px" class="trans-margin">
    <ActionRow
      bind:this={rowRefs["reSignIn"]}
      expanded={reSignInOpen}
      onclick={() => {
        if (reSignInOpen) {
          onReSignInCancel();
        } else {
          reSignInOpen = true;
          rowToReveal = "reSignIn";
        }
      }}
    >
      {#snippet label()}Re-sign in{/snippet}
      {#snippet expandedContent()}
        <ReSignIn
          {me}
          {form}
          bind:banner
          {sessionStatus}
          {loadMe}
          onResolved={onReSignInResolved}
        />
      {/snippet}
    </ActionRow>
  </div>
{/if}

<!-- Email / Password -->
<div style:margin-top="{margins.emailPasswordSection}px" class="trans-margin">
  <SectionHeader label="Email / Password" />
</div>
{#if otp}
  <div style:margin-top="{margins.otp}px" class="trans-margin">
    <div class="rounded-md bg-white px-2 py-2 shadow-lg">
      <OtpProceed {otp} {form} bind:banner {loadMe} {setOtp} />
    </div>
  </div>
{:else if hasPasswordCred}
  <div style:margin-top="{margins.resetToggle}px" class="trans-margin">
    <ActionRow
      bind:this={rowRefs[me.user?.resetDisabled ? "enable-reset" : "disable-reset"]}
      expanded={action === "enable-reset" || action === "disable-reset"}
      disabled={me.user?.resetDisabled
        ? notOpenBlocked("enable-reset") || staleBlocked("enable-reset")
        : notOpenBlocked("disable-reset")}
      onclick={() => {
        const a = me.user?.resetDisabled ? "enable-reset" : "disable-reset";
        openAction(action === "enable-reset" || action === "disable-reset" ? null : a);
      }}
    >
      {#snippet label()}
        <span class="flex items-center gap-1.5 min-w-0">
          <span class="icon-[mdi--email] size-4 scale-110 shrink-0 text-amber-400" aria-hidden="true"></span>
          <span class="italic text-neutral-500 truncate">{me.user?.email}</span>
          <span class="shrink-0"> — {me.user?.resetDisabled ? "cannot" : "can"} reset password</span>
        </span>
      {/snippet}
      {#snippet expandedContent()}
        {#if me.user?.resetDisabled}
          <div class="space-y-2">
            <p class="text-xs text-neutral-600">Re-enable email-based password reset.</p>
            <button
              type="button"
              class="w-full rounded-md bg-neutral-900 py-2 text-sm text-white disabled:opacity-50"
              disabled={form.busy}
              onclick={doEnableReset}
            >{form.busy ? "…" : "Enable"}</button>
          </div>
        {:else}
          <form onsubmit={doDisableReset} class="space-y-2">
            <p class="text-xs text-neutral-600">
              Disable email-based password reset. You'll no longer be able to reset a forgotten
              password by email.
            </p>
            {#if reEnableProviderLabel}
              <p class="text-xs text-amber-800">
                If you forget your password, you'll need to sign in with {reEnableProviderLabel} to re-enable reset.
              </p>
            {:else}
              <p class="text-xs text-amber-800">
                <strong>Warning:</strong> you have no other way to sign in. If you forget your password
                after disabling this, you'll be locked out permanently.
              </p>
            {/if}
            <PasswordInput
              required
              placeholder="Current password"
              bind:value={confirmPassword}
              class="w-full rounded-md border border-amber-300 bg-white py-2 pr-14 pl-3 text-sm"
            />
            <button
              type="submit"
              class="w-full rounded-md bg-amber-700 py-2 text-sm text-white disabled:opacity-50"
              disabled={form.busy}
            >{form.busy ? "…" : "Disable"}</button>
          </form>
        {/if}
      {/snippet}
    </ActionRow>
  </div>

  <div style:margin-top="{margins.changePasswordCred}px" class="trans-margin">
    <ActionRow
      bind:this={rowRefs["change-password-cred"]}
      expanded={action === "change-password-cred"}
      disabled={notOpenBlocked("change-password-cred")}
      onclick={toggleAction("change-password-cred")}
    >
      {#snippet label()}Change email or password{/snippet}
      {#snippet expandedContent()}
        <form onsubmit={doChangePasswordCred} class="space-y-2">
          <PasswordInput
            required
            placeholder="Confirm current password"
            bind:value={curPassword}
            class={[
              "w-full rounded-md border border-neutral-300 py-2 pr-14 pl-3 text-sm",
              curPassword ? "" : "bg-amber-50",
            ]}
          />
          <div class="flex items-center gap-2 pt-1 text-xs text-neutral-400">
            <span class="h-px flex-1 bg-neutral-200"></span>
            <span>new credential</span>
            <span class="h-px flex-1 bg-neutral-200"></span>
          </div>
          <input
            type="email"
            required
            placeholder="Email"
            bind:value={newEmail}
            class="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <PasswordInput
            minlength={8}
            placeholder="New password (leave empty to keep)"
            bind:value={newPassword}
          />
          <button
            type="submit"
            class="w-full rounded-md bg-neutral-900 py-2 text-sm text-white disabled:opacity-50"
            disabled={form.busy || !curPassword || !credentialChange}
          >
            {form.busy ? "…" : emailChanged ? "Continue to verify" : "Continue"}
          </button>
        </form>
      {/snippet}
    </ActionRow>
  </div>

  {#if credentialCount > 1}
    <div style:margin-top="{margins.deletePasswordCred}px" class="trans-margin">
      <ActionRow
        bind:this={rowRefs["delete-password-cred"]}
        expanded={action === "delete-password-cred"}
        disabled={notOpenBlocked("delete-password-cred")}
        onclick={toggleAction("delete-password-cred")}
      >
        {#snippet label()}Remove this credential{/snippet}
        {#snippet expandedContent()}
          <form onsubmit={doDeletePasswordCred} class="space-y-2">
            <PasswordInput
              required
              placeholder="Current password"
              bind:value={confirmPassword}
            />
            <button
              type="submit"
              class="w-full rounded-md bg-neutral-900 py-2 text-sm text-white disabled:opacity-50"
              disabled={form.busy}
            >{form.busy ? "…" : "Remove"}</button>
          </form>
        {/snippet}
      </ActionRow>
    </div>
  {/if}
{:else}
  <div style:margin-top="{margins.addPasswordCred}px" class="trans-margin">
    <ActionRow
      bind:this={rowRefs["add-password-cred"]}
      expanded={action === "add-password-cred"}
      disabled={notOpenBlocked("add-password-cred")}
      onclick={toggleAction("add-password-cred")}
    >
      {#snippet label()}Add credential{/snippet}
      {#snippet expandedContent()}
        <form onsubmit={doAddPasswordCredStart} class="space-y-2">
          <input
            type="email"
            required
            placeholder="Email"
            bind:value={newEmail}
            class="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <PasswordInput
            required
            minlength={8}
            placeholder="Password (min 8)"
            bind:value={newPassword}
          />
          <button
            type="submit"
            class="w-full rounded-md bg-neutral-900 py-2 text-sm text-white disabled:opacity-50"
            disabled={form.busy}
          >{form.busy ? "…" : "Send code"}</button>
        </form>
      {/snippet}
    </ActionRow>
  </div>
{/if}

<!-- Google OAuth -->
<div style:margin-top="{margins.googleSection}px" class="trans-margin">
  <SectionHeader label="Google OAuth" />
</div>
<div style:margin-top="{margins.googleAction}px" class="trans-margin">
  {#if !googleCred}
    <ActionRow
      bind:this={rowRefs["link-google"]}
      expanded={action === "link-google"}
      disabled={notOpenBlocked("link-google")}
      onclick={async () => {
        if (action === "link-google") { openAction(null); return; }
        openAction("link-google");
        try {
          await linkGoogle();
        } finally {
          if ((action as Action) === "link-google") action = null;
        }
      }}
    >
      {#snippet label()}Link Google{/snippet}
      {#snippet expandedContent()}
        <p class="text-xs text-neutral-600">Continue at the popup.</p>
      {/snippet}
    </ActionRow>
  {:else if credentialCount > 1}
    {@const remainingAfterUnlink = me.credentials.filter((c) => c.providerId !== "google")}
    {@const lockoutRisk =
      me.user?.resetDisabled &&
      remainingAfterUnlink.length === 1 &&
      remainingAfterUnlink[0].providerId === "password"}
    <ActionRow
      bind:this={rowRefs["delete-google-cred"]}
      expanded={action === "delete-google-cred"}
      disabled={googleChecking || notOpenBlocked("delete-google-cred")}
      onclick={() => {
        if (action === "delete-google-cred") openAction(null);
        else startDeleteGoogleCred();
      }}
    >
      {#snippet label()}
        {#if googleChecking}Checking…{:else}
          <span class="flex items-center gap-1.5 min-w-0">
            <span class="icon-[logos--google-icon] size-4 shrink-0" aria-hidden="true"></span>
            <span class="italic text-neutral-500 truncate">{googleCred.email ?? googleCred.accountId ?? ""}</span>
            <span class="shrink-0"> — unlink</span>
          </span>
        {/if}
      {/snippet}
      {#snippet expandedContent()}
        <form onsubmit={doDeleteGoogleCred} class="space-y-2">
          {#if lockoutRisk}
            <p class="text-xs text-amber-800">
              <strong>Warning:</strong> after unlinking, your password credential will be your only
              way in (reset disabled; forgetting the password will lock you out).
            </p>
          {/if}
          {#if hasPasswordCred}
            <p class={["text-xs", lockoutRisk ? "text-amber-800" : "text-neutral-600"]}>
              Re-enter your password to unlink.
            </p>
            <PasswordInput
              required
              placeholder="Current password"
              bind:value={confirmPassword}
              class={[
                "w-full rounded-md border bg-white py-2 pr-14 pl-3 text-sm",
                lockoutRisk ? "border-amber-300" : "border-neutral-300",
              ]}
            />
          {:else}
            <p class="text-xs text-neutral-600">Your session is fresh. Confirm to unlink Google.</p>
          {/if}
          <button
            type="submit"
            class={[
              "w-full rounded-md py-2 text-sm text-white disabled:opacity-50",
              lockoutRisk ? "bg-amber-700" : "bg-neutral-900",
            ]}
            disabled={form.busy}
          >{form.busy ? "…" : lockoutRisk ? "Unlink anyway" : "Unlink"}</button>
        </form>
      {/snippet}
    </ActionRow>
  {:else}
    <ActionRow
      expanded={googleInfoExpanded}
      onclick={() => { googleInfoExpanded = !googleInfoExpanded; }}
    >
      {#snippet label()}
        <span class="flex items-center gap-1.5 min-w-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-4 w-4 shrink-0" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          <span class="italic text-neutral-500 truncate">{googleCred.email ?? googleCred.accountId ?? ""}</span>
        </span>
      {/snippet}
      {#snippet expandedContent()}
        <p class="text-xs text-neutral-600">You have no other sign-in method. Add another credential to unlink Google.</p>
      {/snippet}
    </ActionRow>
  {/if}
</div>

<!-- GitHub OAuth -->
<div style:margin-top="{margins.githubSection}px" class="trans-margin">
  <SectionHeader label="GitHub OAuth" />
</div>
<div style:margin-top="{margins.githubAction}px" class="trans-margin">
  {#if !githubCred}
    <ActionRow
      bind:this={rowRefs["link-github"]}
      expanded={action === "link-github"}
      disabled={notOpenBlocked("link-github")}
      onclick={async () => {
        if (action === "link-github") { openAction(null); return; }
        openAction("link-github");
        try {
          await linkGithub();
        } finally {
          if ((action as Action) === "link-github") action = null;
        }
      }}
    >
      {#snippet label()}Link GitHub{/snippet}
      {#snippet expandedContent()}
        <p class="text-xs text-neutral-600">Continue at the popup.</p>
      {/snippet}
    </ActionRow>
  {:else if credentialCount > 1}
    {@const remainingAfterUnlink = me.credentials.filter((c) => c.providerId !== "github")}
    {@const lockoutRisk =
      me.user?.resetDisabled &&
      remainingAfterUnlink.length === 1 &&
      remainingAfterUnlink[0].providerId === "password"}
    <ActionRow
      bind:this={rowRefs["delete-github-cred"]}
      expanded={action === "delete-github-cred"}
      disabled={githubChecking || notOpenBlocked("delete-github-cred")}
      onclick={() => {
        if (action === "delete-github-cred") openAction(null);
        else startDeleteGithubCred();
      }}
    >
      {#snippet label()}
        {#if githubChecking}Checking…{:else}
          <span class="flex items-center gap-1.5 min-w-0">
            <span class="icon-[logos--github-icon] size-4 shrink-0" aria-hidden="true"></span>
            <span class="italic text-neutral-500 truncate">{githubCred.email ?? githubCred.accountId ?? ""}</span>
            <span class="shrink-0"> — unlink</span>
          </span>
        {/if}
      {/snippet}
      {#snippet expandedContent()}
        <form onsubmit={doDeleteGithubCred} class="space-y-2">
          {#if lockoutRisk}
            <p class="text-xs text-amber-800">
              <strong>Warning:</strong> after unlinking, your password credential will be your only
              way in (reset disabled; forgetting the password will lock you out).
            </p>
          {/if}
          {#if hasPasswordCred}
            <p class={["text-xs", lockoutRisk ? "text-amber-800" : "text-neutral-600"]}>
              Re-enter your password to unlink.
            </p>
            <PasswordInput
              required
              placeholder="Current password"
              bind:value={confirmPassword}
              class={[
                "w-full rounded-md border bg-white py-2 pr-14 pl-3 text-sm",
                lockoutRisk ? "border-amber-300" : "border-neutral-300",
              ]}
            />
          {:else}
            <p class="text-xs text-neutral-600">Your session is fresh. Confirm to unlink GitHub.</p>
          {/if}
          <button
            type="submit"
            class={[
              "w-full rounded-md py-2 text-sm text-white disabled:opacity-50",
              lockoutRisk ? "bg-amber-700" : "bg-neutral-900",
            ]}
            disabled={form.busy}
          >{form.busy ? "…" : lockoutRisk ? "Unlink anyway" : "Unlink"}</button>
        </form>
      {/snippet}
    </ActionRow>
  {:else}
    <ActionRow
      expanded={githubInfoExpanded}
      onclick={() => { githubInfoExpanded = !githubInfoExpanded; }}
    >
      {#snippet label()}
        <span class="flex items-center gap-1.5 min-w-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-4 w-4 shrink-0" aria-hidden="true" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
          <span class="italic text-neutral-500 truncate">{githubCred.email ?? githubCred.accountId ?? ""}</span>
        </span>
      {/snippet}
      {#snippet expandedContent()}
        <p class="text-xs text-neutral-600">You have no other sign-in method. Add another credential to unlink GitHub.</p>
      {/snippet}
    </ActionRow>
  {/if}
</div>

<!-- The Exit -->
<div style:margin-top="{margins.accountSection}px" class="trans-margin">
  <SectionHeader label="The Exit" />
</div>
<div style:margin-top="{margins.deleteUser}px" class="trans-margin">
  <ActionRow
    bind:this={rowRefs["delete-user"]}
    expanded={action === "delete-user"}
    variant="danger"
    disabled={deleteChecking || notOpenBlocked("delete-user")}
    onclick={() => {
      if (action === "delete-user") openAction(null);
      else startDeleteUser();
    }}
  >
    {#snippet label()}{deleteChecking ? "Checking…" : "Delete account"}{/snippet}
    {#snippet expandedContent()}
      <form onsubmit={doDeleteUser} class="space-y-2">
        {#if hasPasswordCred}
          <p class="text-xs text-red-800">Re-enter your password to delete.</p>
          <PasswordInput
            required
            placeholder="Current password"
            bind:value={confirmPassword}
            class="w-full rounded-md border border-red-300 bg-white py-2 pr-14 pl-3 text-sm"
          />
        {:else}
          <p class="text-xs text-red-800">
            Your session is fresh. Confirm to permanently delete this account.
          </p>
        {/if}
        <button
          type="submit"
          class="w-full rounded-md bg-red-600 py-2 text-sm text-white disabled:opacity-50"
          disabled={form.busy}
        >{form.busy ? "…" : "Delete"}</button>
      </form>
    {/snippet}
  </ActionRow>
</div>

<div style:margin-top="{margins.signOut}px" class="trans-margin">
  <ActionRow
    bind:this={rowRefs["sign-out"]}
    expanded={action === "sign-out"}
    onclick={toggleAction("sign-out")}
  >
    {#snippet label()}Sign out{/snippet}
    {#snippet expandedContent()}
      <div class="space-y-2">
        <p class="text-xs text-neutral-600">Confirm to end this session.</p>
        <button
          type="button"
          class="w-full rounded-md bg-neutral-900 py-2 text-sm text-white disabled:opacity-50"
          disabled={form.busy}
          onclick={signOut}
        >{form.busy ? "…" : "Confirm sign out"}</button>
      </div>
    {/snippet}
  </ActionRow>
</div>
<div style:height="{bottomSpacerH}px"></div>

<style>
  .trans-margin {
    transition: margin-top 300ms ease;
  }
</style>

