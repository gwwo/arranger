<script lang="ts" module>
  export const operations: {
    value: OperationInstance;
    iconClass: string;
    buttonClass?: string;
  }[] = [
    {
      value: "inbox",
      iconClass: "icon-[streamline-plump--inbox-content-remix] scale-90 text-gray-600",
    },
    {
      value: "planned",
      iconClass: "icon-[mdi--planner] text-red-600",
    },
    {
      value: "search",
      iconClass: "icon-[mingcute--search-fill] scale-110 text-purple-600",
      buttonClass: "mt-4",
    },
    {
      value: "archive",
      iconClass: "icon-[f7--archivebox-fill] scale-90 text-cyan-600",
    },
    {
      value: "trash",
      iconClass: "icon-[mynaui--trash-two-solid] text-gray-400",
    },
  ];
</script>

<script lang="ts">
  import { isPlacementName, type OperationInstance, type PlacementName, type TodoItem } from "$lib/client/model";
  import type { ClassValue } from "svelte/elements";
  import type { Attachment } from "svelte/attachments";
  import {
    useTodoListInserter,
    isTodoItem,
  } from "../todo-panel/TodoListInsert.svelte";
  import { useProjectListInserter } from "../project-list/ProjectListInsert.svelte";
  import {
    useMoveToPlacementFrom,
    useMovePlacementToPlacement,
    useMoveProjectBetweenPlacements,
    useArchiveProject,
    useTrashProject,
  } from "$lib/client/mutate-remote";

  type Props = {
    class: ClassValue;
    showOperation: (op: OperationInstance) => void;
    openInNewPanel?: (op: OperationInstance) => void;
    operationShown: OperationInstance | null;
  };

  let { class: className, showOperation, openInNewPanel, operationShown }: Props = $props();

  const labelFromValue = (value: OperationInstance) =>
    value.charAt(0).toUpperCase() + value.slice(1);

  // ─── Drop receiving ─────────────────────────────────────────────────────────
  // The inbox/archive/trash rows act as drop targets, like a project row in the
  // sidebar list: drag todos (from a project page or another placement view) or
  // project rows (from the sidebar list, archive, or trash) and drop over a row
  // to move them there. Two inserter contexts feed us: todos + placement project
  // rows come through the todo inserter, active sidebar projects through the
  // project inserter. Only one is live during a given drag.
  const componentID = $props.id();
  const todoInserter = useTodoListInserter();
  const projInserter = useProjectListInserter();

  const moveToPlacement = useMoveToPlacementFrom();
  const movePlacement = useMovePlacementToPlacement();
  const moveProjectBetweenPlacements = useMoveProjectBetweenPlacements();
  const archiveProject = useArchiveProject();
  const trashProject = useTrashProject();

  const placementNames = new Set<PlacementName>(["inbox", "archive", "trash"]);

  let hoverOp = $state<OperationInstance | null>(null);

  // The active drag, from whichever inserter context owns it.
  let drag = $derived.by(() => {
    const t = todoInserter.getInsertion?.();
    if (t) return { kind: "todo" as const, insertion: t };
    const p = projInserter.getInsertion?.();
    if (p) return { kind: "proj" as const, insertion: p };
    return null;
  });

  type Plan = { move: () => void };

  // What dropping the current drag on `op` would do, or null if `op` can't take
  // any of the dragged rows (mirrors each placement view's onInsertTargeted).
  function planFor(op: PlacementName, d: NonNullable<typeof drag>): Plan | null {
    if (d.kind === "proj") {
      // Active sidebar projects can be archived/trashed, but not put in the inbox.
      if (op === "inbox") return null;
      const projIds = d.insertion.items.map((it) => it.id);
      if (projIds.length === 0) return null;
      return {
        move: () => projIds.forEach((id) => (op === "archive" ? archiveProject(id) : trashProject(id))),
      };
    }

    const { items, info } = d.insertion;
    const fromProjId = info.fromProjId;
    const fromPlacement = placementNames.has(fromProjId as PlacementName)
      ? (fromProjId as PlacementName)
      : null;
    if (fromPlacement === op) return null; // dropping back where it came from

    const live = items.filter((it) => !it.snapBack);

    if (op === "inbox") {
      const todoIds = new Set(
        live.filter((it) => it.kind !== "proj" && isTodoItem(it.raw)).map((it) => it.id),
      );
      if (todoIds.size === 0) return null;
      return {
        move: () =>
          fromPlacement
            ? movePlacement(fromPlacement, todoIds, "inbox")
            : moveToPlacement(fromProjId, todoIds, "inbox"),
      };
    }

    // archive | trash. Project rows can move between the two; archive only takes
    // completed todos, trash takes any todo.
    const projFrom: PlacementName = op === "archive" ? "trash" : "archive";
    const projIds = new Set(
      live.filter((it) => it.kind === "proj" && fromPlacement === projFrom).map((it) => it.id),
    );
    const todoIds = new Set(
      live
        .filter(
          (it) =>
            it.kind !== "proj" &&
            isTodoItem(it.raw) &&
            (op === "trash" || (it.raw as TodoItem).status === "complete"),
        )
        .map((it) => it.id),
    );
    if (projIds.size === 0 && todoIds.size === 0) return null;
    return {
      move: () => {
        if (projIds.size > 0) moveProjectBetweenPlacements(projFrom, projIds, op);
        if (todoIds.size > 0) {
          if (fromPlacement) movePlacement(fromPlacement, todoIds, op);
          else moveToPlacement(fromProjId, todoIds, op);
        }
      },
    };
  }

  // The plan for the hovered row, if it can receive — drives the receive UI.
  let activePlan = $derived.by(() =>
    drag && hoverOp != null && isPlacementName(hoverOp) ? planFor(hoverOp, drag) : null,
  );

  $effect(() => {
    if (!drag) return;
    if (drag.kind === "todo") {
      if (activePlan) {
        todoInserter.setTarget({ toComponentId: componentID, move: activePlan.move, info: { shrink: true } });
      } else if (todoInserter.getTarget()?.toComponentId === componentID) {
        todoInserter.setTarget(null);
      }
    } else {
      if (activePlan) {
        projInserter.setTarget({ toComponentId: componentID, move: activePlan.move, info: { shrink: true } });
      } else if (projInserter.getTarget()?.toComponentId === componentID) {
        projInserter.setTarget(null);
      }
    }
  });

  const attachReceive =
    (op: OperationInstance): Attachment<HTMLElement> =>
    (node) => {
      const enter = () => (hoverOp = op);
      const leave = () => {
        if (hoverOp === op) hoverOp = null;
      };
      node.addEventListener("mouseenter", enter);
      node.addEventListener("mouseleave", leave);
      return () => {
        node.removeEventListener("mouseenter", enter);
        node.removeEventListener("mouseleave", leave);
      };
    };
</script>

<div class={[className, "font-semibold text-gray-700 select-none"]}>
  {#each operations as op}
    {@const isToReceive = activePlan != null && hoverOp === op.value}
    <div class={["group/row relative", op.buttonClass]}>
      <button
        {@attach attachReceive(op.value)}
        class={[
          "flex h-[28px] w-full items-center gap-2 rounded-md border px-2",
          isToReceive ? "border-teal-500" : "border-transparent",
          // Darken on receive so the shrunk (teal) dragged chip stands out — but
          // never override the shown row's pink background.
          op.value === operationShown ? "bg-pink-200" : isToReceive ? "bg-teal-200" : "",
        ]}
        onclick={(ev) => {
          showOperation(op.value);
          // Drop focus so the row doesn't pick up a :focus-visible outline when
          // the user then drives the opened page with the keyboard (arrow nav).
          ev.currentTarget.blur();
        }}
      >
        <span class={[op.iconClass, "size-4.5"]}></span>
        <p>{labelFromValue(op.value)}</p>
      </button>
      {#if openInNewPanel}
        <button
          class="absolute top-1/2 right-1 hidden size-5 -translate-y-1/2 flex-none items-center justify-center rounded text-gray-500 group-hover/row:flex in-[.dragging-to-insert]:hidden! hover:bg-black/10 hover:text-gray-700 active:bg-black/20"
          aria-label="Open in a new panel"
          title="Open in new panel"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => {
            e.stopPropagation();
            openInNewPanel?.(op.value);
          }}
        >
          <span class="icon-[cuida--open-in-new-tab-outline] size-3.5"></span>
        </button>
      {/if}
    </div>
  {/each}
</div>
