<script lang="ts">
  import { getAppState, getPanelContext } from "$lib/client/context";
  import { usePanelFocus } from "$lib/components/PanelGroup.svelte";
  import type { ArchiveEntry, ArchiveProjEntry, ArchiveTodoEntry } from "$lib/client/model";
  import DragList, { type DragPrep, type TargetPrep } from "$lib/components/drag-insert-list/DragList.svelte";
  import {
    useTodoListInserter,
    isGroupingItem,
    type ItemInsert,
    type InsertInfo,
    type TargetInfo,
  } from "$lib/components/todo-panel/TodoListInsert.svelte";
  import {
    useMoveToPlacementFrom,
    useMovePlacementToPlacement,
    useMoveProjectBetweenPlacements,
    useRestoreProjects,
    useEditArchiveTodo,
    useEditArchiveCheck,
    useMoveArchiveCheck,
    useCreateArchiveCheck,
    useDeleteArchiveCheck,
    useSetPlannedArchive,
  } from "$lib/client/mutate-remote";
  import { usePicker, useContextMenu, toLayoutPoint, placeholder } from "$lib";
  import type { CalendarDate } from "@internationalized/date";
  import { useSetPlacementSelected, useSetPlacementExpanded, useOpenPlacementProject } from "$lib/client/mutate-local";
  import { rangeSelectIds } from "$lib/client/utils";
  import { parsePlanned } from "$lib/client/sync.svelte";
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
  const entries = $derived(appState.archive);

  const moveToPlacement = useMoveToPlacementFrom();
  const movePlacement = useMovePlacementToPlacement();
  const moveProjectBetweenPlacements = useMoveProjectBetweenPlacements();
  const restoreProjects = useRestoreProjects();
  const editArchiveTodo = useEditArchiveTodo();
  const editArchiveCheckFn = useEditArchiveCheck();
  const moveArchiveCheckFn = useMoveArchiveCheck();
  const createArchiveCheckFn = useCreateArchiveCheck();
  const deleteArchiveCheckFn = useDeleteArchiveCheck();
  const setSelected = useSetPlacementSelected();
  const setExpanded = useSetPlacementExpanded();
  const openPlacementProject = useOpenPlacementProject();
  const setPlannedArchive = useSetPlannedArchive();
  const picker = usePicker();
  const contextMenu = useContextMenu();

  // Right-click context menu over the selected entries: unarchive the selected
  // rows (projects → front of the active project list, todos → front of the
  // inbox), or move them to trash.
  const openContextMenu = (ev: MouseEvent, id: string) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!ui.selected.has(id)) setSelected(new Set([id]));
    const selectedEntries = entries.filter((e) => ui.selected.has(e.id));
    if (selectedEntries.length === 0) return;
    const todoIds = selectedEntries
      .filter((e): e is ArchiveTodoEntry => e.kind === "todo")
      .map((e) => e.id);
    const projIds = selectedEntries.filter((e) => e.kind === "proj").map((e) => e.id);
    const count = selectedEntries.length;
    const { x: layoutX, y: layoutY } = toLayoutPoint(ev.clientX, ev.clientY);
    const menuWidth = 224;
    // 40px per row: unarchive + move-to-trash.
    const menuHeight = 2 * 40;
    const margin = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const maxX = Math.max(margin, viewportWidth - menuWidth - margin);
    const maxY = Math.max(margin, viewportHeight - menuHeight - margin);
    const x = Math.min(layoutX, maxX);
    const y = Math.min(layoutY, maxY);
    const unarchiveLabel =
      count === 1 ? "Move row out of archive" : `Move ${count} rows out of archive`;
    const trashLabel = count === 1 ? "Move row to trash" : `Move ${count} rows to trash`;
    contextMenu.popup({
      x,
      y,
      count,
      itemLabel: "row",
      secondaryAction: {
        label: unarchiveLabel,
        onAction: () => {
          // Projects go to the front of the active list; todos to the inbox front.
          if (projIds.length > 0) restoreProjects(projIds, 0);
          if (todoIds.length > 0) movePlacement("archive", new Set(todoIds), "inbox");
          setSelected(new Set());
        },
      },
      deleteLabel: trashLabel,
      onDelete: () => {
        if (projIds.length > 0) moveProjectBetweenPlacements("archive", new Set(projIds), "trash");
        if (todoIds.length > 0) movePlacement("archive", new Set(todoIds), "trash");
        setSelected(new Set());
      },
    });
  };

  // Open the date picker for the selected todos (bottom-bar "assign a date"
  // button, exposed via bind:this). Project entries are ignored.
  export function scheduleDate(anchor: HTMLElement) {
    const selectedTodos = entries.filter(
      (e): e is ArchiveTodoEntry => e.kind === "todo" && ui.selected.has(e.id),
    );
    if (selectedTodos.length === 0) return;
    const ids = new Set(selectedTodos.map((e) => e.id));
    const getDate = (): CalendarDate | null => {
      let agreed: CalendarDate | null = null;
      for (const e of selectedTodos) {
        const planned = parsePlanned(e.planned);
        if (planned == null) continue;
        if (agreed == null) agreed = planned;
        else if (agreed.compare(planned) !== 0) return null;
      }
      return agreed;
    };
    picker.popup({
      anchor,
      getDate,
      setDate: (planned: CalendarDate) => setPlannedArchive(ids, planned),
    });
  }

  // ─── Archived-project drill-in ───────────────────────────────────────────────
  // Double-clicking a project row opens it as a normal, fully-editable project
  // page in this same panel. Archiving removed it from state.projects, so we
  // register a name-only stub (useOpenPlacementProject) and point the panel at
  // it: it shows the standard project view's "Back to Archive" bar + a Loading…
  // placeholder while the lazy loader fetches its rows.
  function enterProject(entry: ArchiveProjEntry) {
    openPlacementProject(entry.id, entry.name, "archive");
  }

  let rowIdToReveal = $state<string | null>(null);

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

  // ─── Keyboard navigation ──────────────────────────────────────────────────────
  const { panelId } = getPanelContext();
  const panelFocus = usePanelFocus();
  // Keyboard target when this is a lone panel or the focused one of several.
  let isKeyboardTarget = $derived(!panelFocus.multiPanel || panelFocus.panelId === panelId);

  // Plain selection-navigation scroll target (distinct from rowIdToReveal, which
  // is for freshly-expanded rows).
  let rowIdToScroll = $state<string | null>(null);

  // Returning from a drilled-in archived project (Back to Archive) preselects
  // that project's row (useExitPlacementProject). On mount, scroll it into view —
  // as if the user had arrow-navigated to it — once the rows have mounted. A
  // single initial selection only ever comes from that drill-in return.
  const initialSelectedId = untrack(() =>
    ui.selected.size === 1 ? [...ui.selected][0] : null,
  );
  $effect(() => {
    if (!initialSelectedId) return;
    const t = setTimeout(() => { rowIdToScroll = initialSelectedId; }, 150);
    return () => clearTimeout(t);
  });

  // Focus a todo's title input once its expanded view has mounted.
  function focusTitleSoon(id: string) {
    tick().then(() => todoRowElements[id]?.focusTitleInput());
  }

  // Move the single selection up/down through the entries (todos + projects),
  // skipping the expanded row. Mirrors InboxView/TodoList navigation.
  function navigateSelection(direction: "up" | "down") {
    const rows = entries;
    if (rows.length === 0) return;
    const selectedIndices = rows.reduce<number[]>((acc, e, i) => {
      if (ui.selected.has(e.id)) acc.push(i);
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

  // Enter: expand the first selected todo (projects don't expand) and focus its
  // title input.
  function activateFirstSelected() {
    const first = entries.find((e) => e.kind === "todo" && ui.selected.has(e.id));
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
        e.key !== "ArrowUp" &&
        e.key !== "ArrowDown" &&
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
        if (entries.length > 0) setSelected(new Set(entries.map((en) => en.id)));
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

  const expandedSpacing = 30;
  // Vertical breathing room above the first row and below the last (the
  // DragList forces its own padding-top/bottom to 0, so edge spacing comes from
  // here). Matches the px-4 horizontal padding.
  const edgePadding = 16;

  const getMarginTop = (pre: ArchiveEntry | null, cur: ArchiveEntry | null) => {
    const expanded =
      (cur?.kind === "todo" && ui.expandedId === cur.id) ||
      (pre?.kind === "todo" && ui.expandedId === pre.id);
    const edge = pre == null || cur == null;
    return Math.max(edge ? edgePadding : 0, expanded ? expandedSpacing : 0);
  };

  function onInsertActive(items: ItemInsert[], toRender: ArchiveEntry[], toDerender: ArchiveEntry[]) {
    // Archive accepts completed todos from anywhere, and project rows (which
    // are only ever dragged from trash since archive→archive is a no-op).
    const hasInsertable = items.some(
      (it) =>
        !it.snapBack &&
        (it.kind === "proj" ||
          (!isGroupingItem(it.raw) && (it.raw as TodoItem).status === "complete")),
    );
    if (!hasInsertable) return { insertables: [] };
    if (toDerender.length > 0) return { insertables: [] };
    // Edge padding sits above the inserted item (spacePrecede); spaceFollow is
    // only the gap to the next row — non-zero just when the first row is expanded.
    const first = toRender[0] ?? null;
    const firstExpanded = first?.kind === "todo" && ui.expandedId === first.id;
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
    if (fromPlacement === "archive") return { move: () => {}, info: {} };
    const projIds = new Set(
      insertion.items.filter((it) => !it.snapBack && it.kind === "proj").map((it) => it.id),
    );
    const todoIds = new Set(
      insertion.items
        .filter(
          (it) =>
            !it.snapBack &&
            it.kind !== "proj" &&
            !isGroupingItem(it.raw) &&
            (it.raw as TodoItem).status === "complete",
        )
        .map((it) => it.id),
    );
    const insertableIds = new Set<string>([...projIds, ...todoIds]);
    const snapBackIds = new Set(
      insertion.items.filter((it) => !insertableIds.has(it.id)).map((it) => it.id),
    );
    return {
      move: () => {
        if (projIds.size > 0 && fromPlacement === "trash") {
          moveProjectBetweenPlacements("trash", projIds, "archive");
        }
        if (todoIds.size > 0) {
          if (fromPlacement != null) movePlacement(fromPlacement, todoIds, "archive");
          else moveToPlacement(fromProjId, todoIds, "archive");
        }
        setSelected(insertableIds);
        // Shift keyboard focus to this panel on drop, mirroring TodoList.
        panelFocus.setFocus(panelId, "main");
      },
      info: { pileWidth: node.getBoundingClientRect().width },
      snapBackIds,
    };
  }

  function entryToTodoItem(entry: ArchiveTodoEntry): TodoItem {
    return {
      id: entry.id,
      title: entry.title,
      note: entry.note,
      status: entry.done ? "complete" : "todo",
      planned: parsePlanned(entry.planned),
      checks: entry.checks ?? [],
    };
  }

  function entryToDragRaw(entry: ArchiveEntry): ItemInsert["raw"] {
    if (entry.kind === "todo") return entryToTodoItem(entry);
    return { id: entry.id, label: entry.name || "" };
  }

  function collapseRow(id: string) {
    // Flush any pending title/note edit (Input updates on blur) before tearing
    // down the expanded view, then collapse and select the row — mirrors the
    // project page (TodoList) and the inbox, where collapsing reselects the row.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setExpanded(null);
    collapsing[id] = true;
    setSelected(new Set([id]));
  }

  function makeDragHandle(
    entry: ArchiveEntry,
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
        const alreadySelected = ui.selected.has(entry.id);

        if (selectRange) {
          const ids = rangeSelectIds(
            entries.map((e) => e.id),
            entry.id,
            (id) => ui.selected.has(id),
          );
          setSelected(new Set(ids));
          pendingClick = undefined;
        } else if (alreadySelected) {
          pendingClick = () => {
            const next = new Set(ui.selected);
            if (selectDuo) next.delete(entry.id);
            else { next.clear(); next.add(entry.id); }
            setSelected(next);
          };
        } else {
          const next = selectDuo ? new Set(ui.selected) : new Set<string>();
          next.add(entry.id);
          setSelected(next);
          pendingClick = undefined;
        }

        const dragIds = ui.selected;
        const dragEntries = entries.filter((e) => dragIds.has(e.id));
        const items: ItemInsert[] = dragEntries.map((e) => ({
          raw: entryToDragRaw(e),
          id: e.id,
          isSelected: true,
          ...(e.kind === "proj" && { kind: "proj" as const, tone: "text-cyan-600" }),
        }));

        if (items.length > 0) prepare({
          items,
          anchorId: entry.id,
          mouseDown: { x: ev.clientX, y: ev.clientY },
          condition: (dx, dy) => Math.sqrt(dx ** 2 + dy ** 2) > 4,
          info: { fromProjId: "archive" },
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

  function handleRowDblClick(entry: ArchiveTodoEntry) {
    if (ui.expandedId === entry.id) {
      collapseRow(entry.id);
    } else {
      setExpanded(entry.id);
      rowIdToReveal = entry.id;
      setSelected(new Set());
      focusTitleSoon(entry.id);
    }
  }

  function clearSelectionOnBlank(node: HTMLElement) {
    const handler = (ev: MouseEvent) => {
      if (!(ev.target as Element).closest("[data-archive-row]")) {
        setSelected(new Set());
      }
    };
    node.addEventListener("mousedown", handler);
    return () => node.removeEventListener("mousedown", handler);
  }
</script>

<div class="flex size-full flex-col">
  <PlacementTitle title="Archive" {topBarHeight} {sideReveal} {resizingSide} />
  <div class="relative min-h-0 flex-1">
    <DragList
      class="h-full overflow-y-auto px-4"
      data={entries}
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
      {#snippet row(items, entry, index, prepare, _phantomIndex)}
        {@const dragHandle = makeDragHandle(entry, prepare)}
        {@const isSelected = ui.selected.has(entry.id)}
        {@const prevSelected = index > 0 && ui.selected.has(items[index - 1].id)}
        {@const nextSelected = index < items.length - 1 && ui.selected.has(items[index + 1].id)}
        {#if entry.kind === "proj"}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            data-archive-row
            bind:this={rowDivElements[entry.id]}
            class={[
              "mx-2 flex h-8 items-center overflow-hidden rounded-md text-cyan-600",
              isSelected && "bg-pink-200",
              prevSelected && "rounded-t-none",
              nextSelected && "rounded-b-none",
            ]}
            ondblclick={() => enterProject(entry)}
            oncontextmenu={(ev) => openContextMenu(ev, entry.id)}
          >
            <!-- Clickable drill-in. Matches a todo row's tickbox geometry
                 (size-8 box, 16px glyph) so the icon lines up with the checkbox.
                 The drag/select handle covers only the name (below), so a click
                 on the icon opens the project without selecting the row — like a
                 todo's tickbox sitting outside the todo's drag overlay. -->
            <button
              class="group flex size-8 shrink-0 cursor-pointer items-center justify-center"
              aria-label="Open project"
              onclick={() => enterProject(entry)}
            >
              <!-- size-8 button keeps the hit area and checkbox alignment; the
                   darkened hover region is the slightly smaller inner square. -->
              <span
                class="flex size-7 items-center justify-center rounded-md group-hover:bg-cyan-600/15"
              >
                <span class="icon-[ri--folder-fill] size-4"></span>
              </span>
            </button>
            <!-- Fills the row height so the drag/select area is flush with the
                 adjacent rows' (no dead band between them); pl/pr match a todo
                 title's so the names line up too. -->
            <span
              class="flex h-full min-w-0 grow cursor-default items-center select-none pr-1.5 pl-0.5 text-sm font-medium"
              {@attach dragHandle}
            >
              <span class="truncate">{entry.name || placeholder.project.name}</span>
            </span>
          </div>
        {:else}
          {@const todo = entryToTodoItem(entry)}
          {@const todoMut = {
            editTodo: (data: Partial<Omit<TodoItem, "checks" | "id">>) => {
              const { status: _ignored, ...rest } = data;
              if (Object.keys(rest).length > 0) editArchiveTodo(entry.id, rest);
            },
            editCheck: (checkId: string, data: Partial<Omit<TodoItem["checks"][number], "id">>) => editArchiveCheckFn(entry.id, checkId, data),
            moveCheck: (checkIds: string[], index: number) => moveArchiveCheckFn(entry.id, checkIds, index),
            createCheck: (checks: Parameters<typeof createArchiveCheckFn>[1], index: number) => createArchiveCheckFn(entry.id, checks, index),
            deleteCheck: (checkId: string) => deleteArchiveCheckFn(entry.id, checkId),
          }}
          {@const isExpanded = ui.expandedId === entry.id}
          {@const isCollapsing = collapsing[entry.id]}
          {@const topOffset = getMarginTop(items[index - 1] ?? null, entry)}
          {@const bottomOffset = getMarginTop(entry, items[index + 1] ?? null)}
          {#if isExpanded}
            <!-- svelte-ignore a11y_consider_explicit_label -->
            <button
              class="absolute inset-x-0"
              style:top="-{topOffset}px"
              style:bottom="-{bottomOffset}px"
              onmousedown={() => { (document.activeElement as HTMLElement | null)?.blur?.(); }}
              onclick={() => collapseRow(entry.id)}
            ></button>
          {/if}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            data-archive-row
            bind:this={rowDivElements[entry.id]}
            ontransitionend={isCollapsing
              ? (e) => { if (e.propertyName !== "background-color") return; collapsing[entry.id] = false; }
              : null}
            class={[
              "relative h-fit overflow-hidden rounded-md",
              isExpanded ? "bg-white px-2 py-2 shadow-lg" : isSelected ? "mx-2 bg-pink-200" : "mx-2",
              !isExpanded && prevSelected && "rounded-t-none",
              !isExpanded && nextSelected && "rounded-b-none",
              (isExpanded || isCollapsing) && "transition-[margin,padding,background-color,box-shadow] duration-200",
            ]}
            ondblclick={!isExpanded ? () => handleRowDblClick(entry) : null}
            oncontextmenu={!isExpanded ? (ev) => openContextMenu(ev, entry.id) : null}
          >
            <TodoRow
              bind:this={todoRowElements[entry.id]}
              {todo}
              expanded={isExpanded}
              draghandle={isExpanded ? undefined : dragHandle}
              mut={todoMut}
              onEnter={() => collapseRow(entry.id)}
              onEscape={() => collapseRow(entry.id)}
            />
          </div>
        {/if}
      {/snippet}
    </DragList>
    {#if entries.length === 0}
      <div
        class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400"
      >
        Archive is empty
      </div>
    {/if}
  </div>
</div>
