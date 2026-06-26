<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  type Props = Omit<HTMLInputAttributes, "type"> & { value?: string };
  let {
    value = $bindable(""),
    class: className = "w-full rounded-md border border-neutral-300 py-2 pr-14 pl-3 text-sm",
    ...rest
  }: Props = $props();

  let show = $state(false);
</script>

<div class="relative">
  <input
    {...rest}
    type={show ? "text" : "password"}
    bind:value
    class={className}
  />
  {#if value !== ""}
    <button
      type="button"
      class="absolute inset-y-0 right-2 my-auto text-xs text-neutral-500 underline"
      onclick={() => (show = !show)}
    >
      {show ? "hide" : "show"}
    </button>
  {/if}
</div>
