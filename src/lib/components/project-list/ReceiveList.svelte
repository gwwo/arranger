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

  type Props = Omit<TProps<Item, ItemInsert, InsertInfo, TargetInfo>, "row" | "scrollActive"> & {
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
    /** Which dragged items this list can absorb. Items that fail the predicate
     *  are not received and snap back to their source instead. Defaults to
     *  accepting everything. */
    receivable?: (item: ReceiveItem) => boolean;
  };

  let {
    data,
    useReceiveInserter,
    receiveItems,
    receivable = () => true,
    row: rowEnhance,
    ...props
  }: Props = $props();

  const componentID = $props.id();
  const { getInsertion, setTarget, getTarget } = useReceiveInserter();

  let insertion = $derived(getInsertion?.());
  let hoverItem: Item | null = $state(null);
  // Whether the current drag carries anything this list can absorb. A pure
  // non-receivable drag (e.g. only project rows) shows no receive state and
  // registers no receive target, so those rows snap back to their source.
  let hasReceivable = $derived(insertion ? insertion.items.some(receivable) : false);

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
    if (!item || !hasReceivable) {
      if (getTarget?.()?.toComponentId === componentID) {
        setTarget?.(null);
      }
      return;
    }

    const {
      items,
      info: { fromProjId },
    } = insertion;
    const receiveIds = items.filter(receivable).map(({ id }) => id);
    const move = () => receiveItems(item, fromProjId, receiveIds);
    // Rejected items (e.g. project rows) are deliberately NOT routed home via
    // snapBackIds. Crossfading them back animates them flying home as a group
    // while the received todos — which have no receiver here — sit stuck at the
    // release point until that animation ends. Instead we let the whole pile
    // disappear and the source list re-render the project rows in place.
    setTarget?.({
      toComponentId: componentID,
      move,
      info: { shrink: true },
    });
  });
</script>

<DragList {data} {...props} scrollActive={() => insertion != null && hasReceivable}>
  {#snippet row(items, item, index, prepare, phantomIndex)}
    {@render rowEnhance(
      items,
      item,
      index,
      prepare,
      phantomIndex,
      attachReceive(item),
      insertion != null && hoverItem?.id === item.id && hasReceivable,
    )}
  {/snippet}
</DragList>
