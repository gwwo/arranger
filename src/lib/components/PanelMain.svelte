<script lang="ts" module>
  import { setProjContext } from "$lib/client/context";
  import { useCreateGrouping, useCreateTodo } from "$lib/client/mutate-remote";

  const useMutator = () => ({
    createGrouping: useCreateGrouping(),
    createTodo: useCreateTodo(),
  });
  type Mutator = ReturnType<typeof useMutator>;
</script>

<script lang="ts">
  import type { ClassValue, SvelteHTMLElements } from "svelte/elements";
  import type { GroupingItem, ProjectInstance, TodoItem } from "$lib";
  import TodoList from "$lib/components/todo-panel/TodoList.svelte";
  import ProgressCircle from "$lib/components/ProgressCircle.svelte";
  import { isGroupingItem, isTodoItem, newGroupingItem, newTodoItem } from "$lib";
  type Props = {
    instance: ProjectInstance;
    bottomBarHeight: number;
    topBarHeight: number;
    newProjIdToReveal: string | null;
    class?: ClassValue;
    mut?: Mutator;
  };

  let {
    instance,
    bottomBarHeight,
    topBarHeight,
    newProjIdToReveal = $bindable(),
    class: className,
    mut: mutator,
  }: Props = $props();

  setProjContext({ projId: instance.project.id });
  const mut = mutator ?? useMutator();

  const firstExpandedId =
    instance.project.rows.find((r) => instance.todoExpanded[r.id])?.id ?? null;
  let rowIdToReveal: string | null = $state(firstExpandedId);

  setProjContext({ projId: instance.project.id });

  let todolistEl: TodoList | null;

  let progressPercent = $derived.by(() => {
    const todos = instance.project.rows.filter(isTodoItem);
    if (todos.length === 0) return 0;
    const doneCount = todos.filter((todo) => todo.status === "complete").length;
    return (doneCount / todos.length) * 100;
  });

  $effect(() => {
    if (newProjIdToReveal !== instance.project.id) return;
    todolistEl?.focusNameInput();
    newProjIdToReveal = null;
  });

  let darkenBackground = $derived.by(() => Object.values(instance.todoExpanded).some(Boolean));
</script>

<div
  class={[
    className,
    "flex size-full flex-col transition-[background-color]",
    darkenBackground ? "bg-[#f5f5f7]" : "bg-[#f9fafb]",
  ]}
  style:padding-top="{topBarHeight}px"
>
  <TodoList
    bind:this={todolistEl}
    data={instance.project}
    expanded={instance.todoExpanded}
    selected={instance.rowSelected}
    bind:rowIdToReveal
    class="flex min-h-0 flex-1 px-4 text-gray-800"
  ></TodoList>

  <div
    class="flex w-full flex-none items-center justify-center gap-2 border-t border-gray-200 text-gray-500"
    style:height="{bottomBarHeight}px"
  >
    <button
      class="flex h-7 w-16 items-center justify-center rounded-full border border-transparent hover:border-gray-300 active:bg-gray-300/20"
      aria-label="create a new todo"
      onclick={async () => {
        const newTodo = await mut.createTodo();
        if (newTodo) rowIdToReveal = newTodo.id;
      }}
    >
      <span class="icon-[material-symbols--add-rounded] size-5"></span>
    </button>
    <button
      class="flex h-7 w-16 items-center justify-center rounded-full border border-transparent hover:border-gray-300 active:bg-gray-300/20"
      aria-label="create a new heading"
      onclick={async () => {
        const newGrouping = await mut.createGrouping();
        if (newGrouping) rowIdToReveal = newGrouping.id;
      }}
    >
      <span class="icon-[ic--outline-new-label] size-5 opacity-80"></span>
    </button>
    <button
      class="flex h-7 w-16 items-center justify-center rounded-full border border-transparent hover:border-gray-300 active:bg-gray-300/20"
      aria-label="assign a date"
    >
      <span class="icon-[stash--calendar-solid] size-5 opacity-80"></span>
    </button>
    <button
      class="flex h-7 w-16 items-center justify-center rounded-full border border-transparent hover:border-gray-300 active:bg-gray-300/20"
      aria-label="progress"
    >
      <ProgressCircle value={progressPercent} />
    </button>
  </div>
</div>
