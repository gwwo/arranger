<script lang="ts" module>
  import { useEditTodo } from "$lib/client/mutate-remote";

  const useMutator = () => ({ editTodo: useEditTodo() });
  type Mutator = ReturnType<typeof useMutator>;
</script>

<script lang="ts">
  import { fade, slide } from "svelte/transition";
  import { Inputbar, Input, Statusbox, ViewSwitch, placeholder } from "$lib";
  import { onMount, tick, untrack, type Component, type Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import type { Attachment } from "svelte/attachments";

  import { type TodoItem } from "$lib";

  import ExpandedTodo from "./ExpandedTodo.svelte";
  import { setTodoContext } from "$lib/client/context";
  import type { ReadonlyDeep } from "$lib/utils/type-gymnastics";

  type Props = {
    todo: ReadonlyDeep<TodoItem>;
    expanded: boolean;
    draghandle?: Attachment<HTMLElement>;
    class?: string;
    mut?: Mutator | null;
  } & HTMLAttributes<HTMLDivElement>;

  let {
    todo,
    expanded: expandedRaw,
    draghandle,
    class: className,
    mut: mutator,
    ...restProps
  }: Props = $props();

  setTodoContext({ rowId: todo.id });

  const mut = mutator === undefined ? useMutator() : mutator;

  // expandedRaw will be invalidated at any `expanded = { [item.id]: true })`
  // which will triggers $effects in ViewSwitch
  let expanded = $derived(expandedRaw === true);

  let view: ViewSwitch<boolean> | undefined;

  // svelte-ignore non_reactive_update
  let expandedTodo: ExpandedTodo | undefined;

  export const getEndHeight = () => (view?.getEndHeight() ?? 0) + 8;
  export const focusTitleInput = () => expandedTodo?.focusTitleInput();
</script>

<div class="relative">
  <div
    class={[
      "flex",
      !expanded &&
        "has-[.checkbox:active]:before:absolute has-[.checkbox:active]:before:inset-0 has-[.checkbox:active]:before:bg-black/5",
    ]}
  >
    <Statusbox
      class="checkbox size-8 shrink-0 p-2"
      bind:status={() => todo.status, (v) => mut?.editTodo({ status: v })}
    ></Statusbox>
    <div class="relative min-w-0 grow py-[4px] pr-[6px] pl-[2px]">
      <ViewSwitch bind:this={view} key={expanded}>
        {#if expanded}
          <ExpandedTodo bind:this={expandedTodo} {todo}></ExpandedTodo>
        {:else}
          <div class="flex">
            <Input
              value={todo.title}
              placeholder={placeholder.todo.title}
              disabled
              class={["h-6 truncate", todo.status === "complete" && "text-gray-400"]}
            ></Input>
            <!-- <div class="size-[1.5rem] shrink-0"></div>
            <div class="size-[1.5rem] shrink-0"></div>
            <div class="size-[1.5rem] shrink-0 ml-auto"></div> -->
          </div>
        {/if}
      </ViewSwitch>
      {#if !expanded}
        <!-- an overlay -->
        <div
          {...restProps}
          {@attach draghandle}
          class="absolute top-0 left-0 size-full focus:outline-none"
          role="button"
          tabindex="0"
        ></div>
      {/if}
    </div>
  </div>
</div>
