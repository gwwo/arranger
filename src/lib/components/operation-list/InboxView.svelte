<script lang="ts">
  import { getAppState, getPanelContext } from "$lib/client/context";
  import { usePanelFocus } from "$lib/components/PanelGroup.svelte";
  import DragList, { type DragPrep, type TargetPrep } from "$lib/components/drag-insert-list/DragList.svelte";
  import {
    useTodoListInserter,
    isGroupingItem,
    type ItemInsert,
    type InsertInfo,
    type TargetInfo,
  } from "$lib/components/todo-panel/TodoListInsert.svelte";
  import { useMoveToPlacementFrom, useMovePlacementToPlacement, useEditInboxTodo, useEditInboxCheck, useMoveInboxCheck, useCreateInboxCheck, useDeleteInboxCheck, useCreateInboxTodo, useMarkInboxTodo, useSetPlannedInbox } from "$lib/client/mutate-remote";
  import { useContextMenu, toLayoutPoint, usePicker } from "$lib";
  import type { CalendarDate } from "@internationalized/date";
  import { useSetPlacementSelected, useSetPlacementExpanded } from "$lib/client/mutate-local";
  import { rangeSelectIds } from "$lib/client/utils";
  import type { Insertion } from "$lib/components/drag-insert-list/InsertPile.svelte";
  import TodoRow from "$lib/components/todo-row/TodoRow.svelte";
  import PlacementTitle from "./PlacementTitle.svelte";
  import { revealOnExpand } from "./revealOnExpand.svelte";
  import { untrack, tick } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import type { PlacementInstance } from "$lib/client/model";
  import type { TodoItem } from "$lib";

  type Props = {
    instance: PlacementInstance;
    topBarHeight?: number;
    sideReveal?: number;
    resizingSide?: boolean;
  };
  let { instance: ui, topBarHeight = 0, sideReveal = 0, resizingSide = false }: Props = $props();

  const appState = getAppState();
  const todos = $derived(appState.inbox);

  const moveToPlacement = useMoveToPlacementFrom();
  const movePlacement = useMovePlacementToPlacement();
  const editInboxTodo = useEditInboxTodo();
  const editInboxCheckFn = useEditInboxCheck();
  const moveInboxCheckFn = useMoveInboxCheck();
  const createInboxCheckFn = useCreateInboxCheck();
  const deleteInboxCheckFn = useDeleteInboxCheck();
  const setSelected = useSetPlacementSelected();
  const setExpanded = useSetPlacementExpanded();
  const createInboxTodo = useCreateInboxTodo();
  const markInboxTodo = useMarkInboxTodo();
  const setPlannedInbox = useSetPlannedInbox();
  const contextMenu = useContextMenu();
  const picker = usePicker();

  const { panelId } = getPanelContext();
  const panelFocus = usePanelFocus();
  // Mirror PanelMain: the inbox is the keyboard target when it's a lone panel or
  // the focused one of several.
  let isKeyboardTarget = $derived(!panelFocus.multiPanel || panelFocus.panelId === panelId);

  let rowIdToReveal = $state<string | null>(null);
  // Plain selection-navigation scroll target (distinct from rowIdToReveal, which
  // is for freshly-expanded rows).
  let rowIdToScroll = $state<string | null>(null);

  // Focus a row's title input once its expanded view has mounted (revealOnExpand
  // only scrolls). Used wherever a row is expanded programmatically.
  function focusTitleSoon(id: string) {
    tick().then(() => todoRowElements[id]?.focusTitleInput());
  }

  // Move the single selection up/down through the inbox, skipping the expanded
  // row. Port of TodoList.navigateSelection (the inbox has no groupings).
  function navigateSelection(direction: "up" | "down") {
    const rows = todos;
    if (rows.length === 0) return;
    const selectedIndices = rows.reduce<number[]>((acc, t, i) => {
      if (ui.selected.has(t.id)) acc.push(i);
      return acc;
    }, []);
    const step = direction === "up" ? -1 : 1;
    let targetIndex =
      selectedIndices.length === 0
        ? direction === "up" ? rows.length - 1 : 0
        : direction === "up"
          ? selectedIndices[0] - 1
          : selectedIndices[selectedIndices.length - 1] + 1;
    while (targetIndex >= 0 && targetIndex < rows.length && ui.expandedId === rows[targetIndex].id) {
      targetIndex += step;
    }
    if (targetIndex < 0 || targetIndex >= rows.length) return;
    const target = rows[targetIndex];
    setSelected(new Set([target.id]));
    rowIdToScroll = target.id;
  }

  // Create a new inbox todo, then reveal + focus its title. Shared by the Space
  // shortcut and the bottom-bar "add todo" button (exposed via bind:this).
  export function createTodo() {
    const created = createInboxTodo();
    if (created) {
      rowIdToReveal = created.id;
      focusTitleSoon(created.id);
    }
  }

  // Open the date picker for the selected todos. Exposed for the bottom-bar
  // "assign a date" button; mirrors PanelMain's picker wiring.
  export function scheduleDate(anchor: HTMLElement) {
    const ids = new Set(ui.selected);
    const selectedTodos = todos.filter((t) => ids.has(t.id));
    if (selectedTodos.length === 0) return;
    const getDate = (): CalendarDate | null => {
      let agreed: CalendarDate | null = null;
      for (const t of selectedTodos) {
        if (t.planned == null) continue;
        if (agreed == null) agreed = t.planned;
        else if (agreed.compare(t.planned) !== 0) return null;
      }
      return agreed;
    };
    picker.popup({
      anchor,
      getDate,
      setDate: (planned: CalendarDate) => setPlannedInbox(ids, planned),
    });
  }

  // Enter: expand the first selected row (mirrors handleRowDblClick's expand).
  function activateFirstSelected() {
    const first = todos.find((t) => ui.selected.has(t.id));
    if (!first || ui.expandedId === first.id) return;
    setExpanded(first.id);
    rowIdToReveal = first.id;
    setSelected(new Set());
    focusTitleSoon(first.id);
  }

  $effect(() => {
    if (!isKeyboardTarget) return;
    const handler = (e: KeyboardEvent) => {
      if (
        e.key !== "Enter" &&
        e.key !== "Delete" &&
        e.key !== "Backspace" &&
        e.key !== "ArrowUp" &&
        e.key !== "ArrowDown" &&
        e.key !== " " &&
        !(e.key === "a" && (e.metaKey || e.ctrlKey))
      ) return;
      const el = e.target as HTMLElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el.isContentEditable
      ) return;
      e.preventDefault();
      if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        if (todos.length > 0) setSelected(new Set(todos.map((t) => t.id)));
        return;
      }
      if (e.key === " ") {
        createTodo();
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        navigateSelection(e.key === "ArrowUp" ? "up" : "down");
        return;
      }
      if (e.key === "Enter") {
        activateFirstSelected();
        return;
      }
      // Delete / Backspace → trash the selected todos.
      if (ui.selected.size > 0) {
        movePlacement("inbox", new Set(ui.selected), "trash");
        setSelected(new Set());
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  // Scroll the navigation target into view (no expand). Mirrors TodoList's
  // rowIdToScroll handling.
  const scrollIntoViewControl: Attachment<HTMLElement> = (node) => {
    $effect(() => {
      if (rowIdToScroll == null) return;
      const rowId = rowIdToScroll;
      untrack(() => { rowIdToScroll = null; });
      const el = rowDivElements[rowId];
      if (!el) return;
      const containerRect = node.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const top = elRect.top - containerRect.top + node.scrollTop;
      const bottom = elRect.bottom - containerRect.top + node.scrollTop;
      if (top < node.scrollTop) {
        node.scrollTo({ top, behavior: "smooth" });
      } else if (bottom > node.scrollTop + node.clientHeight) {
        node.scrollTo({ top: bottom - node.clientHeight, behavior: "smooth" });
      }
    });
  };

  // Reveal a row that was restored as expanded from a previous session, once,
  // on mount — mirrors PanelMain's firstExpandedId behaviour.
  const initialExpandedId = untrack(() => ui.expandedId);
  $effect(() => {
    if (!initialExpandedId) return;
    const t = setTimeout(() => { rowIdToReveal = initialExpandedId; }, 150);
    return () => clearTimeout(t);
  });

  let collapsing: Record<string, boolean> = $state({});
  let todoRowElements: Record<string, TodoRow | null> = $state({});
  let rowDivElements: Record<string, HTMLElement | null> = $state({});

  const expandedSpacing = 30;
  // Vertical breathing room above the first row and below the last (the
  // DragList forces its own padding-top/bottom to 0, so edge spacing comes from
  // here). Matches the px-4 horizontal padding.
  const edgePadding = 16;

  const getMarginTop = (pre: TodoItem | null, cur: TodoItem | null) => {
    const expanded =
      (cur != null && ui.expandedId === cur.id) || (pre != null && ui.expandedId === pre.id);
    const edge = pre == null || cur == null;
    return Math.max(edge ? edgePadding : 0, expanded ? expandedSpacing : 0);
  };

  function onInsertActive(items: ItemInsert[], toRender: TodoItem[], toDerender: TodoItem[]) {
    const hasInsertable = items.some((it) => !it.snapBack && !isGroupingItem(it.raw));
    if (!hasInsertable) return { insertables: [] };
    if (toDerender.length > 0) return { insertables: [] };
    // Edge padding sits above the inserted item (spacePrecede); spaceFollow is
    // only the gap to the next row — non-zero just when the first row is expanded.
    const first = toRender[0] ?? null;
    const firstExpanded = first != null && ui.expandedId === first.id;
    return {
      insertables: [
        { index: 0, spacePrecede: edgePadding, spaceFollow: firstExpanded ? expandedSpacing : 0 },
      ],
    };
  }

  const placementNames = new Set(["inbox", "archive", "trash"] as const);
  type Placement = "inbox" | "archive" | "trash";

  function onInsertTargeted(
    _index: number,
    insertion: Insertion<ItemInsert, InsertInfo>,
    node: HTMLDivElement,
  ): TargetPrep<TargetInfo> {
    const { fromProjId } = insertion.info;
    const fromPlacement = placementNames.has(fromProjId as Placement)
      ? (fromProjId as Placement)
      : null;
    if (fromPlacement === "inbox") return { move: () => {}, info: {} };
    const insertableIds = new Set(
      insertion.items.filter((it) => !it.snapBack && !isGroupingItem(it.raw)).map((it) => it.id),
    );
    const snapBackIds = new Set(
      insertion.items.filter((it) => !insertableIds.has(it.id)).map((it) => it.id),
    );
    return {
      move: () => {
        if (fromPlacement != null) movePlacement(fromPlacement, insertableIds, "inbox");
        else moveToPlacement(fromProjId, insertableIds, "inbox");
        setSelected(insertableIds);
        // Shift keyboard focus to this panel on drop, mirroring TodoList.
        panelFocus.setFocus(panelId, "main");
      },
      info: { pileWidth: node.getBoundingClientRect().width },
      snapBackIds,
    };
  }

  // Right-click context menu over the selected todos. Mirrors TodoList's
  // openContextMenu; the inbox only contains todos (no groupings/heads), so the
  // delete action is always "Move … to trash".
  const openContextMenu = (ev: MouseEvent, id: string) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!ui.selected.has(id)) setSelected(new Set([id]));
    const todoItems = todos.filter((t) => ui.selected.has(t.id));
    const todoIds = todoItems.map((t) => t.id);
    if (todoIds.length === 0) return;
    const count = todoIds.length;
    const allDone = todoItems.every((t) => t.status === "complete");
    const completedIds = todoItems.filter((t) => t.status === "complete").map((t) => t.id);
    const completedCount = completedIds.length;
    const { x: layoutX, y: layoutY } = toLayoutPoint(ev.clientX, ev.clientY);
    const menuWidth = 224;
    // 40px per row: mark/undo + (archive if any completed) + move-to-trash.
    const menuHeight = (2 + (completedCount > 0 ? 1 : 0)) * 40;
    const margin = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const maxX = Math.max(margin, viewportWidth - menuWidth - margin);
    const maxY = Math.max(margin, viewportHeight - menuHeight - margin);
    const x = Math.min(layoutX, maxX);
    const y = Math.min(layoutY, maxY);
    const actionLabel = allDone
      ? count === 1 ? "Undo it" : `Undo ${count} todos`
      : count === 1 ? "Mark as done" : `Mark ${count} todos done`;
    const trashLabel = count === 1 ? "Move todo to trash" : `Move ${count} todos to trash`;
    const archiveLabel =
      completedCount === 1 ? "Archive completed todo" : `Archive ${completedCount} completed todos`;
    contextMenu.popup({
      x,
      y,
      count,
      itemLabel: "todo",
      secondaryAction: {
        label: actionLabel,
        onAction: () => markInboxTodo(new Set(todoIds), allDone ? "todo" : "complete"),
      },
      extraActions:
        completedCount > 0
          ? [
              {
                label: archiveLabel,
                onAction: () => movePlacement("inbox", new Set(completedIds), "archive"),
              },
            ]
          : [],
      deleteLabel: trashLabel,
      onDelete: () => movePlacement("inbox", new Set(todoIds), "trash"),
    });
  };

  function collapseRow(id: string) {
    // Flush any pending title/note edit (Input updates on blur) before tearing
    // down the expanded view, then collapse and select the row — mirrors the
    // project page (TodoList), where collapsing moves the selection to the row.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setExpanded(null);
    collapsing[id] = true;
    setSelected(new Set([id]));
  }

  function makeDragHandle(
    todo: TodoItem,
    prepare: (p: DragPrep<ItemInsert, InsertInfo>) => void,
  ) {
    return (node: HTMLElement) => {
      let pendingClick: (() => void) | undefined;

      const handleMouseDown = (ev: MouseEvent) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        // Selecting another row blurs the focused title input of an expanded
        // todo — the preventDefault above would otherwise keep it focused. This
        // matches the project page, where mousedown moves focus to the row.
        (document.activeElement as HTMLElement | null)?.blur?.();

        const selectDuo = ev.metaKey || ev.ctrlKey;
        const selectRange = ev.shiftKey;
        const alreadySelected = ui.selected.has(todo.id);

        if (selectRange) {
          const ids = rangeSelectIds(
            todos.map((t) => t.id),
            todo.id,
            (id) => ui.selected.has(id),
          );
          setSelected(new Set(ids));
          pendingClick = undefined;
        } else if (alreadySelected) {
          pendingClick = () => {
            const next = new Set(ui.selected);
            if (selectDuo) next.delete(todo.id);
            else { next.clear(); next.add(todo.id); }
            setSelected(next);
          };
        } else {
          const next = selectDuo ? new Set(ui.selected) : new Set<string>();
          next.add(todo.id);
          setSelected(next);
          pendingClick = undefined;
        }

        const dragIds = ui.selected;
        const dragTodos = todos.filter((t) => dragIds.has(t.id));
        const items: ItemInsert[] = dragTodos.map((t) => ({
          raw: t,
          id: t.id,
          isSelected: true,
        }));

        if (items.length > 0) prepare({
          items,
          anchorId: todo.id,
          mouseDown: { x: ev.clientX, y: ev.clientY },
          condition: (dx, dy) => Math.sqrt(dx ** 2 + dy ** 2) > 4,
          info: { fromProjId: "inbox" },
        });
      };

      const handleClick = () => pendingClick?.();
      node.addEventListener("mousedown", handleMouseDown);
      node.addEventListener("click", handleClick);
      return () => {
        node.removeEventListener("mousedown", handleMouseDown);
        node.removeEventListener("click", handleClick);
      };
    };
  }

  function handleRowDblClick(todo: TodoItem) {
    if (ui.expandedId === todo.id) {
      collapseRow(todo.id);
    } else {
      setExpanded(todo.id);
      rowIdToReveal = todo.id;
      setSelected(new Set());
      focusTitleSoon(todo.id);
    }
  }

  function clearSelectionOnBlank(node: HTMLElement) {
    const handler = (ev: MouseEvent) => {
      if (!(ev.target as Element).closest("[data-inbox-row]")) {
        setSelected(new Set());
      }
    };
    node.addEventListener("mousedown", handler);
    return () => node.removeEventListener("mousedown", handler);
  }
</script>

<div class="flex size-full flex-col">
  <PlacementTitle title="Inbox" {topBarHeight} {sideReveal} {resizingSide} />
  <div class="relative min-h-0 flex-1">
    <DragList
      class="h-full overflow-y-auto px-4"
      data={todos}
      allowInsert="all"
      transitionMarginTop
      transitionRearrange="data-change"
      {getMarginTop}
      {onInsertActive}
      {onInsertTargeted}
      useInserter={useTodoListInserter}
      compositeContent
      keepDraggedRows
      {@attach clearSelectionOnBlank}
      {@attach scrollIntoViewControl}
      {@attach revealOnExpand({
        rowIdToReveal: () => rowIdToReveal,
        clear: () => { rowIdToReveal = null; },
        rowEl: (id) => rowDivElements[id],
        endHeight: (id) => todoRowElements[id]?.getEndHeight(),
      })}
    >
      {#snippet phantom()}
        <div class="mx-2 h-full rounded-md bg-gray-200"></div>
      {/snippet}
      {#snippet row(items, todo, index, prepare, _phantomIndex)}
        {@const dragHandle = makeDragHandle(todo, prepare)}
        {@const todoMut = {
          editTodo: (data: Partial<Omit<TodoItem, "checks" | "id">>) => editInboxTodo(todo.id, data),
          editCheck: (checkId: string, data: Partial<Omit<TodoItem["checks"][number], "id">>) => editInboxCheckFn(todo.id, checkId, data),
          moveCheck: (checkIds: string[], index: number) => moveInboxCheckFn(todo.id, checkIds, index),
          createCheck: (checks: Parameters<typeof createInboxCheckFn>[1], index: number) => createInboxCheckFn(todo.id, checks, index),
          deleteCheck: (checkId: string) => deleteInboxCheckFn(todo.id, checkId),
        }}
        {@const isSelected = ui.selected.has(todo.id)}
        {@const prevSelected = index > 0 && ui.selected.has(items[index - 1].id)}
        {@const nextSelected = index < items.length - 1 && ui.selected.has(items[index + 1].id)}
        {@const isExpanded = ui.expandedId === todo.id}
        {@const isCollapsing = collapsing[todo.id]}
        {@const topOffset = getMarginTop(items[index - 1] ?? null, todo)}
        {@const bottomOffset = getMarginTop(todo, items[index + 1] ?? null)}
        {#if isExpanded}
          <!-- svelte-ignore a11y_consider_explicit_label -->
          <button
            class="absolute inset-x-0"
            style:top="-{topOffset}px"
            style:bottom="-{bottomOffset}px"
            onmousedown={() => { (document.activeElement as HTMLElement | null)?.blur?.(); }}
            onclick={() => collapseRow(todo.id)}
          ></button>
        {/if}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          data-inbox-row
          bind:this={rowDivElements[todo.id]}
          ontransitionend={isCollapsing
            ? (e) => { if (e.propertyName !== "background-color") return; collapsing[todo.id] = false; }
            : null}
          class={[
            "relative h-fit overflow-hidden rounded-md",
            isExpanded ? "bg-white px-2 py-2 shadow-lg" : isSelected ? "mx-2 bg-pink-200" : "mx-2",
            !isExpanded && prevSelected && "rounded-t-none",
            !isExpanded && nextSelected && "rounded-b-none",
            (isExpanded || isCollapsing) && "transition-[margin,padding,background-color,box-shadow] duration-200",
          ]}
          ondblclick={!isExpanded ? () => handleRowDblClick(todo) : null}
          oncontextmenu={!isExpanded ? (ev) => openContextMenu(ev, todo.id) : null}
        >
          <TodoRow
            bind:this={todoRowElements[todo.id]}
            {todo}
            expanded={isExpanded}
            draghandle={isExpanded ? undefined : dragHandle}
            mut={todoMut}
            onEnter={() => collapseRow(todo.id)}
            onEscape={() => collapseRow(todo.id)}
          />
        </div>
      {/snippet}
    </DragList>
    {#if todos.length === 0}
      <div
        class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400"
      >
        Inbox is empty
      </div>
    {/if}
  </div>
</div>
