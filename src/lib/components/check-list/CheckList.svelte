<script lang="ts" module>
  import {
    useCheckListInserter,
    type InsertInfo,
    type Item,
    type ItemInsert,
    type TargetInfo,
  } from "./CheckListInsert.svelte";

  export type CheckToFocus = Readonly<{
    index: number;
    moveTo?: { preferredX?: number; near: "top" | "bottom" };
  }>;

  import {
    useCreateCheck,
    useDeleteCheck,
    useMoveCheck,
    useEditCheck,
  } from "$lib/client/mutate-remote";

  const useMutator = () => ({
    createCheck: useCreateCheck(),
    moveCheck: useMoveCheck(),
    deleteCheck: useDeleteCheck(),
    editCheck: useEditCheck(),
  });
  type Mutator = ReturnType<typeof useMutator>;
</script>

<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { Input, newCheckItem, type CheckItem } from "$lib";
  import Tickbox from "./Tickbox.svelte";
  import DragList, { type DragPrep, type TargetPrep } from "../drag-insert-list/DragList.svelte";
  import { createBulletHandler } from "./bulletHandler";
  import type { Attachment } from "svelte/attachments";
  import { type Insertable } from "../drag-insert-list/utils";

  import { type ReadonlyDeep } from "$lib/utils/type-gymnastics";
  import type { Insertion } from "../drag-insert-list/InsertPile.svelte";
  type Props = {
    class?: string;
    data: CheckItem[];
    onNavigateOut?: (
      direction: "up" | "down",
      preferredX: number | undefined,
      ev: KeyboardEvent,
    ) => void;
    checkToFocus: CheckToFocus | null;
    mut?: Mutator;
  };

  let { data, onNavigateOut, checkToFocus, class: className, mut = useMutator() }: Props = $props();

  let inputEl: Record<string, Input | undefined | null> = $state({});

  const addBulletAt = (index: number, ...textsToAdd: string[]) => {
    const checks = textsToAdd.map((text) => ({ text }));
    mut.createCheck(checks, index);
  };

  export function getBulletInput(key: { index?: number; id?: string }): Input | undefined {
    const { id, index } = key;
    if (id != null) return inputEl[id] ?? undefined;
    if (index != null) {
      const b = data[index];
      if (b) return inputEl[b.id] ?? undefined;
    }
  }

  $effect(() => {
    if (checkToFocus == null) return;
    const { index, moveTo } = checkToFocus;
    untrack(() => {
      const inputToFocus = getBulletInput({ index });
      if (moveTo == null) {
        inputToFocus?.setCaretPosition("end");
      } else {
        inputToFocus?.moveCaretToX(moveTo.preferredX, moveTo.near);
      }

      checkToFocus = null;
    });
  });

  const { handlePaste, handleKeyDown, handleNavigate } = createBulletHandler({
    getBulletInput,
    addBulletAt,
    deleteBulletAt: (index) => mut.deleteCheck(data[index].id),
    getBullet: (index) => data[index] ?? undefined,
  });

  let selected: Record<string, boolean | undefined> = $state({});

  const onInsertTargeted = (
    index: number,
    insertion: Insertion<ItemInsert, InsertInfo>,
  ): TargetPrep<TargetInfo> => {
    const checkIds = insertion.items.map(({ id }) => id);
    return { move: () => mut.moveCheck(checkIds, index), info: null };
  };

  const getBorderStyle = (
    items: Item[],
    item: Item,
    index: number, // no need to consider phantomIndex since noDragOut
  ) => {
    const blendable = selected[item.id];
    if (!blendable) return "rounded-xs";
    const preBlendable = index > 0 && selected[items[index - 1].id];
    const nextBlendable = index < items.length - 1 && selected[items[index + 1].id];
    return ["rounded-xs", preBlendable && "rounded-t-none", nextBlendable && "rounded-b-none"];
  };

  const getDragHandle = (
    dataToRender: Item[],
    anchorId: string,
    prepare: (dragPrep: DragPrep<ItemInsert, InsertInfo>) => void,
  ): Attachment<HTMLElement> => {
    const id = anchorId;

    return (node) => {
      let pendingClick: (() => void) | undefined;

      const handleMouseDown = (ev: MouseEvent) => {
        const selectDuo = ev.metaKey || ev.ctrlKey;

        const alreadySelected = selected[id];
        if (alreadySelected) {
          pendingClick = () => {
            if (selectDuo) selected[id] = false;
            else selected = { [id]: true };
          };
        } else {
          if (selectDuo) selected[id] = true;
          else selected = { [id]: true };
          pendingClick = undefined;
        }

        if (selectDuo === false) {
          const idsToDrag = new Set<string>();
          for (const item of dataToRender) {
            if (selected[item.id]) {
              idsToDrag.add(item.id);
            }
          }
          const items = dataToRender.filter(({ id }) => idsToDrag.has(id));
          const mouseDown = { x: ev.clientX, y: ev.clientY };
          const condition = () => true;
          prepare({ items, anchorId: id, mouseDown, condition, info: null });
        }

        node.focus();
        ev.preventDefault();
      };
      const handleClick = (ev: MouseEvent) => pendingClick?.();
      node.addEventListener("mousedown", handleMouseDown);
      node.addEventListener("click", handleClick);
      return () => {
        node.removeEventListener("mousedown", handleMouseDown);
        node.removeEventListener("click", handleClick);
      };
    };
  };

  const getMarginTop = (pre: Item | null, cur: Item | null) =>
    cur == null ? 0 : pre == null ? 0 : -1;

  function onInsertActive(items: ItemInsert[], toRender: Item[]) {
    const len = toRender.length;
    const indices = Array.from({ length: len + 1 }, (_, i) => i);
    const first = items[0];
    const insertables: Insertable[] = indices.map((i) => ({
      index: i,
      spacePrecede: getMarginTop(toRender[i - 1], first),
      spaceFollow: i < len ? getMarginTop(first, toRender[i]) : 0,
    }));
    // const heights: Map<string, number> = new Map();
    // for (const { id } of toRender) heights.set(id, 28);
    // if there's only one line then we can know the height in advance
    return { insertables };
  }
</script>

<DragList
  useInserter={useCheckListInserter}
  noDragOut
  allowInsert="self"
  transitionRearrange="internal-guesture"
  phantomHeight="maximum"
  {getMarginTop}
  {onInsertTargeted}
  {onInsertActive}
  {data}
>
  {#snippet phantom()}
    <div class="mr-0 h-full rounded-xs bg-gray-200"></div>
  {/snippet}

  {#snippet row(items, item, index, prepare)}
    {@const { id } = item}
    {@const total = items.length}
    <div
      class={[
        "relative box-border flex w-full rounded-xs border",
        selected[id] ? "border-[#c0e9ef]" : "border-transparent",
        getBorderStyle(items, item, index),
        !selected[id] && "focus-within:border-gray-200 focus-within:bg-gray-100",
        "before:absolute before:right-1 before:bottom-full before:left-1 before:h-[1px]",
        selected[id] ? "bg-teal-100 before:bg-[#c0e9ef]" : "before:bg-gray-200",
        index === items.length - 1 && [
          "after:absolute after:top-full after:right-1 after:left-1 after:h-[1px]",
          selected[id] ? "after:bg-[#c0e9ef]" : "after:bg-gray-200",
        ],
      ]}
    >
      <div class="flex size-7 shrink-0 items-center justify-center">
        <Tickbox
          class="size-full shrink-0"
          bind:ticked={
            () => item.ticked,
            (v) => (v !== item.ticked ? mut.editCheck(item.id, { ticked: v }) : null)
          }
        ></Tickbox>
      </div>

      <Input
        class={[
          "peer my-0.5 min-h-6 min-w-0 grow text-sm leading-6 wrap-break-word",
          item.ticked && "text-gray-400",
        ]}
        bind:this={inputEl[id]}
        bind:value={
          () => item.text, (v) => (v !== item.text ? mut.editCheck(item.id, { text: v }) : null)
        }
        onNavigateOut={(...args) => {
          const handled = handleNavigate(index, total, ...args);
          if (!handled) onNavigateOut?.(...args);
        }}
        onkeydown={(ev) => handleKeyDown(item, index, total, ev)}
        onpaste={(ev) => handlePaste(item, index, ev)}
        onfocus={() => (selected = {})}
      ></Input>

      <div
        {@attach getDragHandle(items, id, prepare)}
        tabindex="-1"
        class={[
          "relative flex size-7 shrink-0 items-center justify-center focus:outline-none",
          !selected[item.id] && [
            "opacity-0 peer-focus:opacity-70 hover:opacity-70 hover:transition-opacity hover:duration-200",
            "in-[.dragging-to-insert]:pointer-events-none in-[.dragging-to-insert]:opacity-0!",
          ],
        ]}
      >
        <span class="icon-[ph--list-bold] size-4 bg-gray-400"></span>
      </div>
    </div>
  {/snippet}
</DragList>
