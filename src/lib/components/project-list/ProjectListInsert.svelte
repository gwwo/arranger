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
  /** `shrink` collapses the dragged pile to a chip — set by a receive target
   *  (e.g. an operation row) that absorbs the projects rather than reordering
   *  them in place. */
  export type TargetInfo = { shrink?: boolean };

  const [useProjectListInserter, setInserter] =
    createContext<Inserter<ItemInsert, InsertInfo, TargetInfo>>();
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
  {#snippet row(item, index, alive, pile, target)}
    {@const shrink = target?.shrink ?? false}
    {@const width = pile.width}
    {@const overlap = index === 1 ? { x: 3, y: 3 } : index === 2 ? { x: 6, y: 6 } : null}
    {@const base = shrink
      ? {
          x: pile.mouseDownOffset.x - 25,
          y: pile.mouseDownOffset.y - 6,
        }
      : null}
    {@const offset = alive
      ? {
          x: (overlap?.x ?? 0) + (base?.x ?? 0),
          y: (overlap?.y ?? 0) + (base?.y ?? 0),
        }
      : { x: 0, y: 0 }}
    <!-- Outer bg only shows once collapsed to a chip (the inner row covers it at
         full size); match the row's own tone so the chip looks like the row. -->
    {@const bg = item.isShown ? "bg-pink-200" : item.isSelected ? "bg-pink-100" : "bg-teal-100"}
    <div
      class={[
        "overflow-hidden rounded-md duration-250",
        bg,
        alive && (index === 1 || index === 2) && (index === 1 ? "opacity-70" : "opacity-40"),
        alive && index > 2 && shrink
          ? "transition-[transform,opacity]"
          : "transition-[width,height,transform,opacity]",
      ]}
      style:width="{alive && shrink ? 50 : width}px"
      style:height="{alive && shrink ? 16 : 28}px"
      style:transform="translate({offset.x}px, {offset.y}px)"
    >
      <div
        class={[
          alive && shrink && "opacity-0",
          !(alive && (index > 2 || shrink)) && "transition-opacity duration-300",
        ]}
        style:width="{width}px"
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
    </div>
  {/snippet}
</InsertPile>
