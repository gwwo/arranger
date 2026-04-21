<script lang="ts" module>
  import {
    useTodoListInserter,
    isGroupingItem,
    isTodoItem,
    isHeadItem,
    type Item,
    type ItemInsert,
    type InsertInfo,
    headItem,
    type TargetInfo,
  } from "./TodoListInsert.svelte";
  import {
    useSetRowSelected,
    useSelectRow,
    useUnselectRow,
    useSetTodoExpanded,
    useUnexpandTodo,
  } from "$lib/client/mutate-local";
  import {
    useMoveRow,
    useDeleteRow,
    useMarkTodo,
    useEditProject,
    useEditGrouping,
  } from "$lib/client/mutate-remote";

  const useMutator = () => ({
    setRowSelected: useSetRowSelected(),
    selectRow: useSelectRow(),
    unselectRow: useUnselectRow(),
    setTodoExpanded: useSetTodoExpanded(),
    unexpandTodo: useUnexpandTodo(),
    moveRow: useMoveRow(),
    deleteRow: useDeleteRow(),
    markTodo: useMarkTodo(),
    editProj: useEditProject(),
    editGrouping: useEditGrouping(),
  });
  type Mutator = ReturnType<typeof useMutator>;
</script>

<script lang="ts">
  import { Input, placeholder, scrollWithCallback, TodoRow, type ProjectItem } from "$lib";
  import { tick, untrack, type Snippet } from "svelte";
  import { type Attachment } from "svelte/attachments";

  import { type RowItem, usePickerScrollCanceller, toLayoutPoint } from "$lib";
  import DragList, { type DragPrep, type TargetPrep } from "../drag-insert-list/DragList.svelte";
  import DormantInput from "../DormantInput.svelte";
  import { useContextMenu } from "$lib";
  import type { ClassValue } from "svelte/elements";
  import { type Insertable } from "../drag-insert-list/utils";
  import { autoPrune } from "$lib/utils/reactive.svelte";

  import type { ReadonlyDeep } from "$lib/utils/type-gymnastics";
  import type { Insertion } from "../drag-insert-list/InsertPile.svelte";

  type Props = {
    class?: string;
    data: ProjectItem;
    noDragOut?: boolean;
    expanded: ReadonlyDeep<Record<string, boolean | undefined>>;
    selected: ReadonlyDeep<Record<string, boolean | undefined>>;
    rowIdToReveal: string | null;
    mut?: Mutator;
  };

  let {
    class: className,
    data,
    noDragOut,
    expanded,
    selected,
    rowIdToReveal = $bindable(),
    mut = useMutator(),
    ...restProps
  }: Props = $props();

  let rows: Item[] = $derived([headItem, ...data.rows]);

  let collapsing: Record<string, boolean | undefined> = $state({});

  $effect(() => {
    const ids = new Set(data.rows.map(({ id }) => id));
    untrack(() => {
      Object.keys(collapsing).forEach((key) => {
        if (!ids.has(key)) delete collapsing[key];
      });
    });
  });

  const expandedSpacing = 30;

  const getMarginTop = (pre: Item | null, cur: Item | null) => {
    if (cur == null) return 30;
    if (pre == null || isHeadItem(cur)) {
      return 30;
    }
    const base = isHeadItem(pre) ? 30 : isGroupingItem(cur) ? 40 : isGroupingItem(pre) ? 10 : 0;
    if ((!isHeadItem(pre) && expanded[pre.id]) || expanded[cur.id]) {
      return Math.max(expandedSpacing, base);
    }
    return base;
  };

  const getBorderStyle = (
    items: Item[],
    item: ReadonlyDeep<RowItem>,
    index: number,
    phantomIndex: number | undefined,
  ): ClassValue => {
    const isBlendable = (it: Item) => isTodoItem(it) && selected[it.id] && !expanded[it.id];
    const blendable = isBlendable(item);
    if (!blendable) return "rounded-md";
    // HeadItem always at index = 0
    const preBlendable = index > 1 && isBlendable(items[index - 1]);
    const nextBlendable = index < items.length - 1 && isBlendable(items[index + 1]);
    const abovePhantom = phantomIndex === index + 1;
    const belowPhantom = phantomIndex === index;
    return [
      "rounded-md",
      !belowPhantom && preBlendable && "rounded-t-none",
      !abovePhantom && nextBlendable && "rounded-b-none",
    ];
  };

  const onInsertTargeted = (
    index: number,
    insertion: Insertion<ItemInsert, InsertInfo>,
    node: HTMLDivElement,
  ): TargetPrep<TargetInfo> => {
    const {
      info: { fromProjId },
      items,
    } = insertion;
    const move = () => {
      // remember to use index - 1, since we prepended a HeadItem
      const rowIds = items.map(({ id }) => id);
      mut.moveRow(fromProjId, rowIds, index - 1);
      const idsToSelect = new Set(items.flatMap(({ id, isSelected }) => (isSelected ? [id] : [])));
      mut.setRowSelected(idsToSelect);
    };
    const pileWidth = node.getBoundingClientRect().width;
    return { move, info: { pileWidth } };
  };

  let headRowEl: HTMLDivElement | null = $state(null);
  let todoRowElements: Record<string, TodoRow | null> = $state({});
  let groupingElements: Record<string, DormantInput | null> = $state({});
  let nameInputEl: Input | null = $state(null);
  const contextMenu = useContextMenu();

  export const focusNameInput = () => untrack(() => nameInputEl?.setCaretPosition("end"));

  autoPrune(() => groupingElements);
  autoPrune(() => todoRowElements);

  const expandDuration = 300;

  const openContextMenu = (ev: MouseEvent, id: string) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!selected[id]) {
      mut.setRowSelected(id);
    }
    const ids = rows.flatMap((item) => (!isHeadItem(item) && selected[item.id] ? [item.id] : []));
    const todoItems = rows.flatMap((item) =>
      !isHeadItem(item) && isTodoItem(item) && selected[item.id] ? [item] : [],
    );
    const todoIds = todoItems.map((item) => item.id);
    const allTodosDone =
      todoItems.length > 0 && todoItems.every((item) => item.status === "complete");
    const { x: layoutX, y: layoutY } = toLayoutPoint(ev.clientX, ev.clientY);
    const menuWidth = 200;
    const menuHeight = todoIds.length > 0 ? 80 : 48;
    const margin = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const maxX = Math.max(margin, viewportWidth - menuWidth - margin);
    const maxY = Math.max(margin, viewportHeight - menuHeight - margin);
    const x = Math.min(layoutX, maxX);
    const y = Math.min(layoutY, maxY);
    const todoCount = todoIds.length;
    const actionLabel =
      todoCount === 0
        ? ""
        : allTodosDone
          ? todoCount === 1
            ? "Undo it"
            : `Undo ${todoCount} todos`
          : todoCount === 1
            ? "Mark as done"
            : `Mark ${todoCount} todos done`;
    contextMenu.popup({
      x,
      y,
      count: ids.length,
      itemLabel: "row",
      secondaryAction:
        todoCount > 0
          ? {
              label: actionLabel,
              onAction: () => {
                mut.markTodo(new Set(todoIds), allTodosDone ? "todo" : "complete");
              },
            }
          : undefined,
      onDelete: () => {
        mut.deleteRow(new Set(ids));
      },
    });
  };

  const scrollIntoViewControl: Attachment<HTMLDivElement> = (node) => {
    $effect(() => {
      if (rowIdToReveal == null) return;
      const rowId = rowIdToReveal;
      // `todoRowElements` hasn't been bind consistently yet, until settimeout
      setTimeout(() => {
        const index = rows.findIndex(({ id }) => id === rowId);
        if (index < 0) return;
        const item = rows[index];
        const isGrouping = isGroupingItem(item);
        const isTodo = isTodoItem(item);
        if (!isGrouping && !isTodo) return;
        if (isGrouping && groupingElements[rowId] == null) return;
        if (isTodo && todoRowElements[rowId] == null) return;

        let top = 0;
        let bottom = 0;
        for (let i = 0; i <= index; i++) {
          const pre = rows[i - 1];
          const cur = rows[i];
          const mt = getMarginTop(pre, cur);
          const h = isHeadItem(cur)
            ? (headRowEl?.offsetHeight ?? 0)
            : isTodoItem(cur)
              ? expanded[cur.id]
                ? 16 + (todoRowElements[cur.id]?.getEndHeight() ?? 0)
                : 32 // do not need to measure unexpanded todo rows
              : 32; // must be GroupingItem
          top = bottom + mt;
          bottom = top + h;
        }
        if (isTodo && expanded[rowId]) {
          top -= expandedSpacing;
          bottom += expandedSpacing;
        }

        const focus = () => {
          if (isGrouping) groupingElements[rowId]?.focus();
          else if (isTodo) todoRowElements[rowId]?.focusTitleInput();
          rowIdToReveal = null; // immediately reset, or when unexpanded?
        };

        const viewTop = node.scrollTop;
        const viewBottom = node.clientHeight + viewTop;
        if (top >= viewTop && bottom <= viewBottom) {
          setTimeout(focus, expandDuration);
          return;
        }

        const isRowTall = bottom - top >= viewBottom - viewTop;
        const isRowOutsideView = top >= viewBottom || bottom <= viewTop;
        const isRowOverlapsBottom = top < viewBottom && bottom > viewBottom;

        const target = isRowTall
          ? top
          : isRowOutsideView
            ? (top + bottom - node.offsetHeight) / 2
            : isRowOverlapsBottom
              ? bottom - node.clientHeight
              : top;
        const maxScrollTopNow = node.scrollHeight - node.clientHeight;
        const delay = target >= maxScrollTopNow ? expandDuration : null;
        scrollWithCallback(node, target, focus, 200, delay);
      });
    });
  };

  const getDragHandle = (
    dataToRender: Item[],
    anchorId: string,
    prepare: (dragprep: DragPrep<ItemInsert, InsertInfo>) => void,
  ): Attachment<HTMLElement> => {
    const id = anchorId;
    return (node) => {
      let pendingClick: (() => void) | undefined;

      const getDragIds = (ent: Item): string[] => {
        let ids: string[] = [];
        if (isHeadItem(ent)) return ids;
        let started = false;
        for (const v of dataToRender) {
          if (started) {
            if (isGroupingItem(v)) break;
            ids.push(v.id);
          } else if (v.id === ent.id) {
            started = true;
            ids.push(ent.id);
            if (!isGroupingItem(ent)) break;
          }
        }
        return ids;
      };

      const handleMouseDown = (ev: MouseEvent) => {
        const selectDuo = ev.metaKey || ev.ctrlKey;

        const alreadySelected = selected[id];
        if (alreadySelected) {
          pendingClick = () => {
            if (selectDuo) mut.unselectRow(id);
            else mut.setRowSelected(id);
          };
        } else {
          if (selectDuo) mut.selectRow(id);
          else mut.setRowSelected(id);
          pendingClick = undefined;
        }

        const idsToDrag = new Set<string>();
        for (const item of dataToRender) {
          if (selected[item.id]) {
            for (const id of getDragIds(item)) {
              idsToDrag.add(id);
            }
          }
        }
        const items: ItemInsert[] = dataToRender
          .filter(({ id }) => idsToDrag.has(id))
          .map((raw) => ({
            raw,
            id: raw.id,
            isSelected: selected[raw.id],
          }));

        const mouseDown = { x: ev.clientX, y: ev.clientY };
        const condition = (dx: number, dy: number) => Math.sqrt(dx ** 2 + dy ** 2) > 4;
        prepare({ items, anchorId: id, mouseDown, condition, info: { fromProjId: data.id } });

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

  const selectedCleanup: Attachment<HTMLElement> = (node) => {
    const handler = (ev: MouseEvent) => {
      const clickedEl = ev.target as HTMLElement;
      const parentDraggable = clickedEl.closest(".movable");
      if (!parentDraggable || !node.contains(parentDraggable)) {
        mut.setRowSelected(null);
      }
    };
    node.addEventListener("mousedown", handler);
    return () => node.removeEventListener("mousedown", handler);
  };

  function onInsertActive(items: ItemInsert[], toRender: Item[], toDerender: Item[]) {
    mut.unexpandTodo(toDerender.map(({ id }) => id));

    const hasGrouping = items.some((it) => isGroupingItem(it.raw));
    const len = toRender.length;
    const insertables: Insertable[] = [];
    const heights: Map<string, number> = new Map();
    const first = items[0].raw;

    toRender.forEach((cur, i) => {
      const insertBehind =
        !hasGrouping ||
        i === 0 ||
        i + 1 === len ||
        // i < len - 1
        isGroupingItem(toRender[i + 1]);
      if (insertBehind) {
        const index = i + 1;
        insertables.push({
          index,
          spacePrecede: getMarginTop(cur, first),
          spaceFollow: index < len ? getMarginTop(first, toRender[i + 1]) : 0,
        });
      }
      const h = isGroupingItem(cur) ? 32 : isTodoItem(cur) && !expanded[cur.id] ? 32 : null;
      if (h != null) heights.set(cur.id, h);
    });
    return { insertables, heights };
  }
</script>

<DragList
  class={["overflow-x-hidden overflow-y-auto", className]}
  {getMarginTop}
  transitionMarginTop
  allowInsert="all"
  transitionRearrange="data-change"
  {onInsertTargeted}
  {onInsertActive}
  {noDragOut}
  useInserter={useTodoListInserter}
  data={rows}
  {@attach usePickerScrollCanceller()}
  {@attach scrollIntoViewControl}
  {@attach selectedCleanup}
  {...restProps}
>
  {#snippet phantom()}
    <div class="mx-2 h-full rounded-md bg-gray-200"></div>
  {/snippet}

  {#snippet row(items, item, index, prepare, phantomIndex)}
    {@const { id } = item}
    {@const draghandle = getDragHandle(items, id, prepare)}
    {#if isHeadItem(item)}
      <div bind:this={headRowEl} class="movable mx-4">
        <Input
          bind:this={nameInputEl}
          class="text-2xl font-semibold wrap-break-word"
          bind:value={() => data.name, (v) => (v !== data.name ? mut.editProj({ name: v }) : null)}
          updateOnBlur
          placeholder={placeholder.project.name}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        ></Input>
        <Input
          class="mt-4 min-h-12 text-base wrap-break-word"
          bind:value={() => data.note, (v) => (v !== data.note ? mut.editProj({ note: v }) : null)}
          updateOnBlur
          placeholder={placeholder.project.note}
        ></Input>
      </div>
    {:else}
      {@const borderStyle = getBorderStyle(items, item, index, phantomIndex)}
      {#if isGroupingItem(item)}
        <div
          class={[
            "movable relative mx-2 h-8 overflow-hidden",
            borderStyle,
            selected[id] && "bg-pink-200",
            // 'after:absolute after:right-2 after:bottom-0 after:left-2 after:h-px',
            // !selected[id] && 'after:bg-gray-300'
          ]}
        >
          <DormantInput
            bind:this={groupingElements[id]}
            class="flex h-full w-full items-center px-4 font-semibold text-teal-600"
            placeholder={placeholder.grouping.label}
            bind:value={
              () => item.label,
              (v) => (v !== item.label ? mut.editGrouping(item.id, { label: v }) : null)
            }
            {@attach draghandle}
            oncontextmenu={(ev) => openContextMenu(ev, id)}
          ></DormantInput>
        </div>
      {:else}
        {#if expanded[id]}
          <!-- svelte-ignore a11y_consider_explicit_label -->
          <button
            class="absolute inset-x-0"
            style:top={`-${getMarginTop(items[index - 1], item)}px`}
            style:bottom={`-${getMarginTop(item, items[index + 1])}px`}
            onclick={() => {
              mut.unexpandTodo(id);
              collapsing[id] = true;
              mut.setRowSelected(id);
            }}
          ></button>
        {/if}
        <div
          ontransitionend={collapsing[id]
            ? (e) => {
                if (e.propertyName !== "background-color") return;
                collapsing[id] = false;
              }
            : null}
          class={[
            "movable relative h-fit overflow-hidden",
            borderStyle,
            expanded[id] ? "bg-white" : selected[id] && "bg-pink-200",
            expanded[id] ? "px-2 py-2 shadow-lg" : "mx-2",
            (expanded[id] || collapsing[id]) &&
              "transition-[margin,padding,background-color,box-shadow] duration-300",
          ]}
        >
          <TodoRow
            bind:this={todoRowElements[id]}
            {draghandle}
            oncontextmenu={(ev) => openContextMenu(ev, id)}
            todo={item}
            expanded={expanded[id] == true}
            ondblclick={() => {
              Object.entries(expanded).forEach(([key, val]) => {
                if (val) {
                  collapsing[key] = true;
                }
              });
              rowIdToReveal = id;
              mut.setTodoExpanded(id);
              mut.setRowSelected(id);
            }}
          ></TodoRow>
        </div>
      {/if}
    {/if}
  {/snippet}
</DragList>
