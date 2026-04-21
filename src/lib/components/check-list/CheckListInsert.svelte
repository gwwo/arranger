<script lang="ts" module>
  import { createInserterContext } from "$lib/components/drag-insert-list/InsertPile.svelte";

  import type { CheckItem } from "$lib";

  export type Item = CheckItem;

  export type ItemInsert = CheckItem;

  export type InsertInfo = null;
  export type TargetInfo = null;

  const [useCheckListInserter, setInserter] = createInserterContext<
    ItemInsert,
    InsertInfo,
    TargetInfo
  >();

  export { useCheckListInserter };
</script>

<script lang="ts">
  import InsertPile from "$lib/components/drag-insert-list/InsertPile.svelte";
  import type { Snippet } from "svelte";
  import Tickbox from "./Tickbox.svelte";
  import type { ReadonlyDeep } from "$lib/utils/type-gymnastics";

  type Props = { children: Snippet };
  let { children }: Props = $props();
</script>

<InsertPile pileRenderOffset={{ x: 8, y: -8 }} {setInserter} {children}>
  {#snippet row(item)}
    <div
      class={[
        "flex w-full overflow-hidden rounded-xs bg-teal-100",
        "box-border border border-[#c0e9ef]",
      ]}
    >
      <div class="flex size-7 shrink-0 items-center justify-center">
        <Tickbox class="size-full shrink-0" ticked={item.ticked}></Tickbox>
      </div>
      <div
        class={[
          "my-0.5 min-h-6 min-w-0 grow text-sm leading-6 wrap-break-word",
          item.ticked && "text-gray-400",
        ]}
      >
        {item.text}
      </div>
      <div class="flex size-7 shrink-0 items-center justify-center">
        <span class="icon-[ph--list-bold] size-4 bg-gray-400"></span>
      </div>
    </div>
  {/snippet}
</InsertPile>
