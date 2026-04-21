<script lang="ts" module>
  import type { Snippet } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import type { Inserter } from "../drag-insert-list/InsertPile.svelte";
  import type { DragPrep, Props as TProps } from "../drag-insert-list/DragList.svelte";
</script>

<script
  lang="ts"
  generics="Item extends {id: string}, ItemInsert extends {id: string}, ReceiveItem extends {id: string}, InsertInfo, TargetInfo"
>
  import DragList from "../drag-insert-list/DragList.svelte";

  type Props = Omit<TProps<Item, ItemInsert, InsertInfo, TargetInfo>, "row"> & {
    row: Snippet<
      [
        items: Item[],
        item: Item,
        index: number,
        prepare: (dragPrep: DragPrep<ItemInsert, InsertInfo>) => void,
        phantomIndex: number | undefined,
        receiveListener: Attachment<HTMLElement>,
        isToReceive: boolean,
      ]
    >;
    useReceiveInserter: () => Inserter<ReceiveItem, { fromProjId: string }, { shrink: true }>;
    receiveItems: (target: Item, fromListId: string, itemIdsToReceive: string[]) => void;
  };

  let { data, useReceiveInserter, receiveItems, row: rowEnhance, ...props }: Props = $props();

  const componentID = $props.id();
  const { getInsertion, setTarget, getTarget } = useReceiveInserter();

  let insertion = $derived(getInsertion?.());
  let hoverItem: Item | null = $state(null);

  const attachReceive =
    (item: Item): Attachment<HTMLElement> =>
    (node) => {
      const handleEnter = () => {
        hoverItem = item;
      };
      const handleLeave = () => {
        if (hoverItem?.id !== item.id) return;
        hoverItem = null;
      };

      node.addEventListener("mouseenter", handleEnter);
      node.addEventListener("mouseleave", handleLeave);
      return () => {
        node.removeEventListener("mouseenter", handleEnter);
        node.removeEventListener("mouseleave", handleLeave);
      };
    };

  $effect(() => {
    if (insertion == null) return;
    const item = hoverItem;
    if (!item) {
      if (getTarget?.()?.toComponentId === componentID) {
        setTarget?.(null);
      }
      return;
    }

    const {
      items,
      info: { fromProjId },
    } = insertion;
    const receiveIds = items.map(({ id }) => id);
    const move = () => receiveItems(item, fromProjId, receiveIds);
    setTarget?.({
      toComponentId: componentID,
      move,
      info: { shrink: true },
    });
  });
</script>

<DragList {data} {...props}>
  {#snippet row(items, item, index, prepare, phantomIndex)}
    {@render rowEnhance(
      items,
      item,
      index,
      prepare,
      phantomIndex,
      attachReceive(item),
      insertion != null && hoverItem?.id === item.id,
    )}
  {/snippet}
</DragList>
