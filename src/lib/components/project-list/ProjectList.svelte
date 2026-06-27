<script lang="ts" module>
  import type { ProjectItem } from "$lib/client/model";
  import type { Attachment } from "svelte/attachments";
  import DormantInput from "../DormantInput.svelte";
  import { type DragPrep, type TargetPrep } from "../drag-insert-list/DragList.svelte";
  import {
    useProjectListInserter,
    type ItemInsert,
    type Item,
    type InsertInfo,
    type TargetInfo,
  } from "./ProjectListInsert.svelte";
  import {
    useTodoListInserter,
    isHeadItem,
    type ItemInsert as TodoItemInsert,
  } from "../todo-panel/TodoListInsert.svelte";
  import { type RowItem, isGroupingItem, placeholder, toLayoutPoint } from "$lib";
  import { useContextMenu } from "$lib";
  import { rangeSelectIds } from "$lib/client/utils";
  import { type Insertable } from "../drag-insert-list/utils";
  import ReceiveList from "./ReceiveList.svelte";

  import { type Insertion, type Inserter } from "../drag-insert-list/InsertPile.svelte";
  import {
    useEditProject,
    useMoveProject,
    useMoveRow,
    useMoveFromPlacementToProject,
    useRestoreProjects,
    useArchiveProject,
    useTrashProject,
  } from "$lib/client/mutate-remote";

  const placementSources = new Set(["inbox", "archive", "trash"]);

  // Height of a sidebar project row (matches the h-[28px] row markup below).
  const projectRowHeight = 28;

  const useMutator = () => {
    const moveRow = useMoveRow.dynamic();
    const moveFromPlacement = useMoveFromPlacementToProject.dynamic();
    const editProj = useEditProject.dynamic();
    return {
      receiveRow: (fromProjId: string, rowIds: string[], toProjId: string) =>
        moveRow({ projId: toProjId }, fromProjId, rowIds),
      receiveFromPlacement: (toProjId: string, todoIds: string[], index: number) =>
        moveFromPlacement({ projId: toProjId }, todoIds, index),
      moveProject: useMoveProject(),
      restoreProjects: useRestoreProjects(),
      archiveProject: useArchiveProject(),
      trashProject: useTrashProject(),
      editProjectName: (projId: string, name: string) => editProj({ projId }, { name }),
    };
  };

  // Inserter passed to the list's DragList. It composes the project inserter
  // (self-reorder of sidebar projects) with the todo inserter so an all-project
  // drag coming from an operation view (inbox/archive/trash) drives the same
  // reorder phantom — the drop then restores those projects into the list.
  // Mixed/todo drags return no insertion here, so they stay on ReceiveList's
  // receive path (Mode 1) and show no phantom.
  const useReceivingProjectInserter = (): Inserter<ItemInsert, InsertInfo, TargetInfo> => {
    const proj = useProjectListInserter();
    const todo = useTodoListInserter();
    const externalActive = () => {
      if (proj.getInsertion()) return false;
      const t = todo.getInsertion();
      return !!t && t.items.length > 0 && t.items.every((it) => it.kind === "proj");
    };
    // The dragged pile comes from an operation view, where a project row is
    // taller (h-8) than a sidebar list row (projectRowHeight). Re-pile the
    // insertion at the sidebar row height so the phantom gap matches the row
    // that lands in it — otherwise the following rows shift on drop. Memoized so
    // the insertion identity stays stable across reads during the drag.
    let extSource: ReturnType<typeof todo.getInsertion>;
    let extWrapped: Insertion<ItemInsert, InsertInfo> | undefined;
    return {
      register: proj.register,
      receive: proj.receive,
      getPileComfinedOffsetTop: () =>
        proj.getPileComfinedOffsetTop() ?? todo.getPileComfinedOffsetTop(),
      getInsertion: () => {
        const p = proj.getInsertion();
        if (p) return p;
        if (externalActive()) {
          const t = todo.getInsertion()!;
          if (t !== extSource) {
            extSource = t;
            extWrapped = {
              ...t,
              pile: { ...t.pile, height: projectRowHeight },
            } as unknown as Insertion<ItemInsert, InsertInfo>;
          }
          return extWrapped;
        }
        extSource = undefined;
        extWrapped = undefined;
        return undefined;
      },
      setTarget: (t) => {
        if (externalActive()) {
          // Shrink the dragged pile to a chip while the phantom is active, like
          // the receive case — the todo InsertPile reads info.shrink.
          const todoTarget = t && { ...t, info: { shrink: true } };
          todo.setTarget(todoTarget as unknown as Parameters<typeof todo.setTarget>[0]);
        } else {
          proj.setTarget(t);
        }
      },
      getTarget: () => (externalActive() ? todo.getTarget() : proj.getTarget()),
    };
  };

  type Mutator = ReturnType<typeof useMutator>;
</script>

<script lang="ts">
  type Props = {
    class?: string;
    data: ProjectItem[];
    projIdShown: string | null;
    // projIdToReveal: string | null;
    showProject: (proj: ProjectItem) => void;
    openInNewPanel?: (proj: ProjectItem) => void;
    selected?: Record<string, boolean | undefined>;
    mut?: Mutator;
  };

  let {
    data,
    class: className,
    projIdShown,
    // projIdToReveal = $bindable(),
    showProject,
    openInNewPanel,
    selected = $bindable({}),
    mut = useMutator(),
  }: Props = $props();
  const contextMenu = useContextMenu();

  // The id of the row currently being renamed (DormantInput in edit mode). The
  // "open in new panel" affordance is hidden for this row so it doesn't sit over
  // the text field while typing.
  let editingId = $state<string | null>(null);

  // const { receiveRows, moveProjects, deleteProjects } = useMutator();

  const onInsertTargeted = (
    index: number,
    insertion: Insertion<ItemInsert, InsertInfo>,
  ): TargetPrep<TargetInfo> => {
    const projIds = insertion.items.map(({ id }) => id);
    // Only the todo inserter carries `info.fromProjId`; its presence marks an
    // external all-project drag from an operation view → restore, not reorder.
    const external = (insertion.info as { fromProjId?: string } | null)?.fromProjId != null;
    const move = () => {
      if (external) mut.restoreProjects(projIds, index);
      else mut.moveProject(projIds, index);
    };
    return { move, info: {} };
  };

  const getBorderStyle = (
    items: Item[],
    item: Item,
    index: number,
    phantomIndex: number | undefined,
  ) => {
    const blendable = selected[item.id];
    if (!blendable) return "rounded-md";
    const preBlendable = index > 0 && selected[items[index - 1].id];
    const nextBlendable = index < items.length - 1 && selected[items[index + 1].id];
    const abovePhantom = phantomIndex === index + 1;
    const belowPhantom = phantomIndex === index;
    return [
      "rounded-md",
      !belowPhantom && preBlendable && "rounded-t-none",
      !abovePhantom && nextBlendable && "rounded-b-none",
    ];
  };

  const getDragHandle = (
    dataToRender: Item[],
    anchor: Item,
    index: number,
    prepare: (dragPrep: DragPrep<ItemInsert, InsertInfo>) => void,
  ): Attachment<HTMLElement> => {
    return (node) => {
      let pendingClick: (() => void) | null = null;

      const findNextSelected = () => {
        const startIndex = index;
        for (let offset = 1; offset <= dataToRender.length; offset += 1) {
          const item = dataToRender[(startIndex + offset) % dataToRender.length];
          if (selected[item.id]) return item;
        }
        return null;
      };

      const handleMouseDown = (ev: MouseEvent) => {
        const selectDuo = ev.metaKey || ev.ctrlKey;
        const selectRange = ev.shiftKey;
        const alreadySelected = selected[anchor.id];
        const selectedIds = dataToRender.flatMap(({ id }) => (selected[id] ? [id] : []));
        const soloSelected = selectedIds.length === 1 && selectedIds[0] === anchor.id;

        // The shown project row is always treated as selected (highlighted), so
        // it acts as a range anchor and must survive a shift-click range that
        // lands entirely before it — re-add it when it falls outside the range.
        const rangeIds = selectRange
          ? (() => {
              const range = rangeSelectIds(
                dataToRender.map(({ id }) => id),
                anchor.id,
                (id) => !!selected[id] || id === projIdShown,
              );
              return projIdShown != null && !range.includes(projIdShown)
                ? [...range, projIdShown]
                : range;
            })()
          : null;

        const isRemoving = selectDuo && alreadySelected;
        const isAdding = selectDuo && !alreadySelected;
        const isReplacing = !selectDuo;

        pendingClick = rangeIds
          ? () => {
              selected = Object.fromEntries(rangeIds.map((id) => [id, true]));
            }
          : isRemoving && soloSelected
            ? null
            : () => {
                if (isRemoving) {
                  selected[anchor.id] = false;
                  if (projIdShown === anchor.id) {
                    const nextSelected = findNextSelected();
                    if (nextSelected) showProject(nextSelected);
                  }
                  return;
                }
                if (isReplacing) selected = { [anchor.id]: true };
                if (isAdding) {
                  selected[anchor.id] = true;
                  return;
                }
                showProject(anchor);
              };

        const dataForDrag = rangeIds
          ? dataToRender.filter(({ id }) => rangeIds.includes(id))
          : alreadySelected
            ? dataToRender.filter(({ id }) => selected[id])
            : [anchor];

        const items: ItemInsert[] = dataForDrag.map((raw) => ({
          raw,
          id: raw.id,
          isSelected: rangeIds != null || alreadySelected,
          isShown: raw.id === projIdShown,
        }));

        const mouseDown = { x: ev.clientX, y: ev.clientY };
        const condition = (dx: number, dy: number) => Math.sqrt(dx ** 2 + dy ** 2) > 4;
        prepare({ items, anchorId: anchor.id, mouseDown, condition, info: null });

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
    cur == null ? 10 : pre == null ? 30 : 0;

  function onInsertActive(items: ItemInsert[], toRender: Item[]) {
    const len = toRender.length;
    const indices = Array.from({ length: len + 1 }, (_, i) => i);
    const first = items[0].raw;
    const insertables: Insertable[] = indices.map((i) => ({
      index: i,
      spacePrecede: getMarginTop(toRender[i - 1], first),
      spaceFollow: i < len ? getMarginTop(first, toRender[i]) : 0,
    }));
    const heights: Map<string, number> = new Map();
    for (const { id } of toRender) heights.set(id, projectRowHeight);
    return { insertables, heights };
  }

  const receiveItems = (item: ProjectItem, fromListId: string, itemIdsToReceive: string[]) => {
    if (placementSources.has(fromListId)) {
      // From inbox/archive/trash: pull the todos into this project. Insert before
      // the first grouping (or at the end) — same default as a project→project
      // drop (useMoveRow). The server's full fetch always lists todos before
      // groups, so appending at the absolute array end would render below the
      // groupings locally and then jump up on reload.
      const firstGroupIdx = item.rows.findIndex((row) => isGroupingItem(row));
      const index = firstGroupIdx >= 0 ? firstGroupIdx : item.rows.length;
      mut.receiveFromPlacement(item.id, itemIdsToReceive, index);
    } else {
      mut.receiveRow(fromListId, itemIdsToReceive, item.id);
    }
  };

  const openContextMenu = (ev: MouseEvent, item: ProjectItem) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!selected[item.id]) {
      selected = { [item.id]: true };
    }
    const ids = data.flatMap(({ id }) => (selected[id] ? [id] : []));
    const { x: layoutX, y: layoutY } = toLayoutPoint(ev.clientX, ev.clientY);
    const menuWidth = 224;
    const menuHeight = 48;
    const margin = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const maxX = Math.max(margin, viewportWidth - menuWidth - margin);
    const maxY = Math.max(margin, viewportHeight - menuHeight - margin);
    const x = Math.min(layoutX, maxX);
    const y = Math.min(layoutY, maxY);
    contextMenu.popup({
      x,
      y,
      count: ids.length,
      itemLabel: "project",
      secondaryAction: {
        label: ids.length === 1 ? "Archive project" : `Archive ${ids.length} projects`,
        onAction: () => {
          for (const id of ids) mut.archiveProject(id);
          ids.forEach((id) => delete selected[id]);
        },
      },
      deleteLabel: ids.length === 1 ? "Move project to trash" : `Move ${ids.length} projects to trash`,
      onDelete: () => {
        for (const id of ids) mut.trashProject(id);
        ids.forEach((id) => delete selected[id]);
      },
    });
  };
</script>

<ReceiveList
  class={["overflow-x-hidden overflow-y-auto", className]}
  useInserter={useReceivingProjectInserter}
  useReceiveInserter={useTodoListInserter}
  allowInsert="all"
  transitionRearrange="internal-guesture"
  {getMarginTop}
  {onInsertActive}
  {onInsertTargeted}
  {receiveItems}
  receivable={(it: TodoItemInsert) => it.kind !== "proj"}
  {data}
>
  {#snippet phantom()}
    <div class="h-full rounded-md bg-teal-200"></div>
  {/snippet}
  {#snippet row(items, item, index, prepare, phantomIndex, listener, isToReceive)}
    <div
      {@attach listener}
      class={[
        "group/row flex h-[28px] w-full items-center border text-sm",
        isToReceive ? "border-teal-500" : "border-transparent",
        getBorderStyle(items, item, index, phantomIndex),
        projIdShown === item.id
          ? isToReceive
            ? "bg-pink-300"
            : "bg-pink-200"
          : selected[item.id]
            ? "bg-pink-100"
            : "",
      ]}
    >
      <DormantInput
        oncontextmenu={(ev) => openContextMenu(ev, item)}
        class="flex h-full min-w-0 flex-1 items-center overflow-hidden bg-transparent px-2 outline-none"
        placeholder={placeholder.project.name}
        onFocus={() => (editingId = item.id)}
        onBlur={() => editingId === item.id && (editingId = null)}
        bind:value={
          () => item.name, (v) => (v !== item.name ? mut.editProjectName(item.id, v) : null)
        }
        {@attach getDragHandle(items, item, index, prepare)}
      ></DormantInput>
      {#if openInNewPanel && editingId !== item.id}
        <button
          class="mr-1 -ml-1 hidden size-5 flex-none items-center justify-center rounded text-gray-500 group-hover/row:flex in-[.dragging-to-insert]:hidden! hover:bg-black/10 hover:text-gray-700 active:bg-black/20"
          aria-label="Open list in a new panel"
          title="Open in new panel"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => {
            e.stopPropagation();
            openInNewPanel?.(item);
          }}
        >
          <span class="icon-[cuida--open-in-new-tab-outline] size-3.5"></span>
        </button>
      {/if}
    </div>
  {/snippet}
</ReceiveList>
