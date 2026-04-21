<script lang="ts" module>
  import {
    createInserterContext,
    type Inserter,
  } from "$lib/components/drag-insert-list/InsertPile.svelte";
  import { placeholder, type ProjectItem } from "$lib/client/model";

  export type Item = ProjectItem;

  export type ItemInsert = {
    raw: Item;
    id: string;
    isSelected?: boolean;
    isShown?: boolean;
  };

  export type InsertInfo = null;
  export type TargetInfo = null;

  const [useProjectListInserter, setInserter] =
    createContext<Inserter<ItemInsert, InsertInfo, InsertInfo>>();
  export { useProjectListInserter };
</script>

<script lang="ts">
  import InsertPile from "$lib/components/drag-insert-list/InsertPile.svelte";
  import { createContext, type Snippet } from "svelte";
  import DormantInput from "../DormantInput.svelte";

  type Props = { children: Snippet };
  let { children }: Props = $props();
</script>

<InsertPile {setInserter} {children}>
  {#snippet row(item, index, alive)}
    {@const overlap = index === 1 ? { x: 3, y: 3 } : index === 2 ? { x: 6, y: 6 } : null}
    {@const offset = alive
      ? {
          x: overlap?.x ?? 0,
          y: overlap?.y ?? 0,
        }
      : { x: 0, y: 0 }}
    <div
      class={[
        "h-fit w-full transition-[transform,opacity]",
        alive && (index === 1 || index === 2) && (index === 1 ? "opacity-70" : "opacity-40"),
      ]}
      style:transform="translate({offset.x}px, {offset.y}px)"
    >
      <DormantInput
        class={[
          "flex h-7 w-full items-center rounded-md border px-2 text-sm",
          item.isShown ? "bg-pink-200" : item.isSelected ? "bg-pink-100" : "border bg-teal-100",
          item.isShown || item.isSelected ? "border-transparent" : "border-gray-300",
        ]}
        value={item.raw.name}
        placeholder={placeholder.project.name}
      ></DormantInput>
    </div>
  {/snippet}
</InsertPile>
