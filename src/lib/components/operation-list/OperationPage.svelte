<script lang="ts">
  import type { OperationInstance } from "$lib/client/model";
  import { operations } from "./OperationList.svelte";

  type Props = {
    instance: OperationInstance;
  };
  let { instance: value }: Props = $props();

  let iconClass = $derived(
    operations.find((operation) => operation.value === value)?.iconClass ?? "",
  );
</script>

<div class="flex size-full items-center justify-center gap-3 bg-[#f9fafb]">
  {#if iconClass}
    <span class={[iconClass, "size-6"]}></span>
  {/if}
  <span class="font-semibold text-gray-700">Under Construction</span>
</div>
