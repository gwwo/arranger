<script lang="ts" module>
  import { type Inserter } from "$lib/components/drag-insert-list/InsertPile.svelte";
  import type { ReadonlyDeep } from "$lib/utils/type-gymnastics";

  import type { RowItem, GroupingItem, TodoItem } from "$lib";

  import { isGroupingItem as isG, isTodoItem as isT, placeholder, TodoRow } from "$lib";

  type HeadItem = { id: "head" };
  export const headItem: HeadItem = { id: "head" } as const;
  export type Item = ReadonlyDeep<RowItem> | ReadonlyDeep<HeadItem>;

  export const isHeadItem = (item: Item): item is ReadonlyDeep<HeadItem> => item.id === "head";
  export const isGroupingItem = (item: Item): item is ReadonlyDeep<GroupingItem> =>
    !isHeadItem(item) && "label" in item;
  export const isTodoItem = (item: Item): item is ReadonlyDeep<TodoItem> =>
    !isHeadItem(item) && "title" in item && "status" in item;

  export type ItemInsert = {
    raw: Item;
    id: string;
    isSelected?: boolean;
    snapBack?: boolean;
    /** Marks a project entry being dragged from archive/trash. Project rows
     *  are grouping-shaped in `raw` so non-placement targets filter them out;
     *  this flag lets placement targets opt in. */
    kind?: "proj";
    /** Text-color class for a dragged project row, so the drag pile matches the
     *  source placement (archive = cyan, trash = gray) instead of a fixed hue. */
    tone?: string;
  };

  export type InsertInfo = {
    fromProjId: string;
  };

  export type TargetInfo = {
    pileWidth?: number;
    shrink?: boolean;
  };

  const [useTodoListInserter, setInserter] =
    createContext<Inserter<ItemInsert, InsertInfo, TargetInfo>>();

  export { useTodoListInserter };

  export const paddingX = 8;
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
    {@const w = !target || shrink || target.pileWidth == null ? pile.width : target.pileWidth}
    {@const width = w - paddingX * 2}
    {@const { raw, isSelected, kind, tone } = item}
    {@const overlap = index === 1 ? { x: 3, y: 3 } : index === 2 ? { x: 6, y: 6 } : null}
    {@const base = shrink
      ? {
          x: pile.mouseDownOffset.x - 25,
          y: pile.mouseDownOffset.y - 8,
        }
      : null}
    {@const offset = alive
      ? {
          x: (overlap?.x ?? 0) + (base?.x ?? 0),
          y: (overlap?.y ?? 0) + (base?.y ?? 0),
        }
      : { x: 0, y: 0 }}
    <div
      class={[
        "overflow-hidden rounded-md duration-250",
        alive && (index === 1 || index === 2) && (index === 1 ? "opacity-70" : "opacity-40"),
        index === 0 && alive && "shadow-xl",
        isSelected ? "bg-pink-200" : "bg-[#f9fafb]",
        alive && index > 2 && shrink
          ? // disable size transition: alive && index > 2 && shrink
            "transition-[transform,opacity]"
          : "transition-[width,height,transform,opacity]",
      ]}
      style:width="{alive && shrink ? 50 : width}px"
      style:height="{alive && shrink ? 16 : 32}px"
      style:transform="translate({offset.x}px, {offset.y}px)"
      style:margin-left="{paddingX}px"
    >
      <div
        class={[
          alive && shrink && "opacity-0",
          // disable text opacity transition: alive && (index > 2 || shrink)
          !(alive && (index > 2 || shrink)) && "transition-opacity duration-300",
        ]}
        style:width="{width}px"
      >
        {#if kind === "proj" && isGroupingItem(raw)}
          <div class={["flex h-8 items-center gap-2 px-2", tone ?? "text-cyan-600"]}>
            <span class="icon-[ri--folder-fill] size-4 shrink-0"></span>
            <span class="flex-1 cursor-default select-none truncate text-sm font-medium">
              {raw.label || "Untitled Project"}
            </span>
          </div>
        {:else if isGroupingItem(raw)}
          <DormantInput
            disabled
            placeholder={placeholder.grouping.label}
            class="flex h-8 w-full items-center px-4 font-semibold text-teal-600"
            value={raw.label}
          ></DormantInput>
        {:else if isTodoItem(raw)}
          <TodoRow todo={raw} expanded={false} mut={null}></TodoRow>
        {/if}
      </div>
    </div>
  {/snippet}
</InsertPile>
