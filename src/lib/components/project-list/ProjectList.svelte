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
  import { type Insertable } from "../drag-insert-list/utils";
  import ReceiveList from "./ReceiveList.svelte";

  import { type Insertion } from "../drag-insert-list/InsertPile.svelte";
  import {
    useDeleteProject,
    useEditProject,
    useMoveProject,
    useMoveRow,
  } from "$lib/client/mutate-remote";

  const useMutator = () => {
    const moveRow = useMoveRow.dynamic();
    const editProj = useEditProject.dynamic();
    return {
      receiveRow: (fromProjId: string, rowIds: string[], toProjId: string) =>
        moveRow({ projId: toProjId }, fromProjId, rowIds),
      moveProject: useMoveProject(),
      deleteProject: useDeleteProject(),
      editProjectName: (projId: string, name: string) => editProj({ projId }, { name }),
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
    selected?: Record<string, boolean | undefined>;
    mut?: Mutator;
  };

  let {
    data,
    class: className,
    projIdShown,
    // projIdToReveal = $bindable(),
    showProject,
    selected = $bindable({}),
    mut = useMutator(),
  }: Props = $props();
  const contextMenu = useContextMenu();

  // const { receiveRows, moveProjects, deleteProjects } = useMutator();

  const onInsertTargeted = (
    index: number,
    insertion: Insertion<ItemInsert, InsertInfo>,
  ): TargetPrep<TargetInfo> => {
    const projIds = insertion.items.map(({ id }) => id);
    const move = () => {
      mut.moveProject(projIds, index);
    };
    return { move, info: null };
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
        const alreadySelected = selected[anchor.id];
        const selectedIds = dataToRender.flatMap(({ id }) => (selected[id] ? [id] : []));
        const soloSelected = selectedIds.length === 1 && selectedIds[0] === anchor.id;

        const isRemoving = selectDuo && alreadySelected;
        const isAdding = selectDuo && !alreadySelected;
        const isReplacing = !selectDuo;

        pendingClick =
          isRemoving && soloSelected
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
                if (isAdding) selected[anchor.id] = true;
                showProject(anchor);
              };

        const dataForDrag = alreadySelected
          ? dataToRender.filter(({ id }) => selected[id])
          : [anchor];

        const items: ItemInsert[] = dataForDrag.map((raw) => ({
          raw,
          id: raw.id,
          isSelected: alreadySelected,
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
    for (const { id } of toRender) heights.set(id, 28);
    return { insertables, heights };
  }

  const receiveItems = (item: ProjectItem, fromListId: string, itemIdsToReceive: string[]) => {
    mut.receiveRow(fromListId, itemIdsToReceive, item.id);
  };

  const openContextMenu = (ev: MouseEvent, item: ProjectItem) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!selected[item.id]) {
      selected = { [item.id]: true };
    }
    const ids = data.flatMap(({ id }) => (selected[id] ? [id] : []));
    const { x: layoutX, y: layoutY } = toLayoutPoint(ev.clientX, ev.clientY);
    const menuWidth = 160;
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
      onDelete: () => {
        const idsToDelete = new Set(ids);
        mut.deleteProject(idsToDelete).then(() => {
          Object.keys(selected).forEach((id) => {
            if (idsToDelete.has(id)) delete selected[id];
          });
        });
      },
    });
  };
</script>

<ReceiveList
  class={["overflow-x-hidden overflow-y-auto", className]}
  useInserter={useProjectListInserter}
  useReceiveInserter={useTodoListInserter}
  allowInsert="self"
  transitionRearrange="internal-guesture"
  {getMarginTop}
  {onInsertActive}
  {onInsertTargeted}
  {receiveItems}
  {data}
>
  {#snippet phantom()}
    <div class="h-full rounded-md bg-teal-200"></div>
  {/snippet}
  {#snippet row(items, item, index, prepare, phantomIndex, listener, isToReceive)}
    <div
      {@attach listener}
      class={["h-fit w-full", getBorderStyle(items, item, index, phantomIndex)]}
    >
      <DormantInput
        oncontextmenu={(ev) => openContextMenu(ev, item)}
        class={[
          "flex h-[28px] w-full items-center border px-2 text-sm",
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
        placeholder={placeholder.project.name}
        bind:value={
          () => item.name, (v) => (v !== item.name ? mut.editProjectName(item.id, v) : null)
        }
        {@attach getDragHandle(items, item, index, prepare)}
      ></DormantInput>
    </div>
  {/snippet}
</ReceiveList>
