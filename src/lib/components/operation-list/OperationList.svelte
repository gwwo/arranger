<script lang="ts" module>
  export const operations: {
    value: OperationInstance;
    iconClass: string;
    buttonClass?: string;
  }[] = [
    {
      value: "inbox",
      iconClass: "icon-[streamline-plump--inbox-content-remix] scale-90 text-gray-600",
    },
    {
      value: "planned",
      iconClass: "icon-[mdi--planner] text-red-600",
    },
    {
      value: "search",
      iconClass: "icon-[mingcute--search-fill] scale-110 text-purple-600",
      buttonClass: "mt-4",
    },
    {
      value: "archive",
      iconClass: "icon-[f7--archivebox-fill] scale-90 text-cyan-600",
    },
    {
      value: "trash",
      iconClass: "icon-[mynaui--trash-two-solid] text-gray-400",
    },
  ];
</script>

<script lang="ts">
  import type { OperationInstance } from "$lib/client/model";
  import type { ClassValue, HTMLAttributes } from "svelte/elements";

  type Props = {
    class: ClassValue;
    showOperation: (op: OperationInstance) => void;
    operationShown: OperationInstance | null;
  };

  let { class: className, showOperation, operationShown }: Props = $props();

  const labelFromValue = (value: OperationInstance) =>
    value.charAt(0).toUpperCase() + value.slice(1);
</script>

<div class={[className, "font-semibold text-gray-700 select-none"]}>
  {#each operations as op}
    <button
      class={[
        "flex h-[28px] w-full items-center gap-2 rounded-md px-2",
        op.buttonClass,
        op.value === operationShown ? "bg-pink-200" : "",
      ]}
      onclick={() => showOperation(op.value)}
    >
      <span class={[op.iconClass, "size-4.5"]}></span>
      <p>{labelFromValue(op.value)}</p>
    </button>
  {/each}
</div>
