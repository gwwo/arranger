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
  import type { CalendarDate } from "@internationalized/date";

  import { type TodoItem } from "$lib";
  import { getDayOfW, getMonthName, getToday } from "$lib/components/calendar/utils";

  import ExpandedTodo from "./ExpandedTodo.svelte";
  import { setTodoContext } from "$lib/client/context";
  import type { ReadonlyDeep } from "$lib/utils/type-gymnastics";

  const formatPlannedShort = (planned: CalendarDate) => {
    const diff = planned.compare(getToday());
    if (diff >= 0 && diff < 7) {
      const w = getDayOfW(planned);
      return w[0].toUpperCase() + w.slice(1);
    }
    const month = getMonthName(planned.month).slice(0, 3);
    if (planned.year === getToday().year) {
      return `${planned.day} ${month}`;
    }
    return `${planned.day} ${month} ${planned.year}`;
  };

  type Props = {
    todo: ReadonlyDeep<TodoItem>;
    expanded: boolean;
    draghandle?: Attachment<HTMLElement>;
    class?: string;
    mut?: Mutator | null;
    onEnter?: () => void;
    onEscape?: () => void;
  } & HTMLAttributes<HTMLDivElement>;

  let {
    todo,
    expanded: expandedRaw,
    draghandle,
    class: className,
    mut: mutator,
    onEnter,
    onEscape,
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
      <ViewSwitch bind:this={view} key={expanded} duration={200}>
        {#if expanded}
          <ExpandedTodo bind:this={expandedTodo} {todo} {onEnter} {onEscape} mut={mutator === null ? null : (mutator ?? undefined)}></ExpandedTodo>
        {:else}
          <div class="flex items-center">
            <Input
              value={todo.title}
              placeholder={placeholder.todo.title}
              disabled
              class={[
                // whitespace-pre (not truncate's nowrap): Blink strips a leading
                // whitespace run at the start of a nowrap line box, WebKit keeps it.
                // `pre` preserves it in both, and ellipsis still works with overflow-hidden.
                "h-6 min-w-0 overflow-hidden text-ellipsis whitespace-pre text-[15px]",
                todo.status === "complete" && "text-gray-400",
              ]}
            ></Input>
            {#if todo.checks.length > 0 || todo.note !== ""}
              <div class="ml-1.5 flex shrink-0 items-center gap-0.5">
                {#if todo.note !== ""}
                  <span
                    class="icon-[akar-icons--paper] size-3 text-gray-400"
                    aria-label="has note"
                  ></span>
                {/if}
                {#if todo.checks.length > 0}
                  <span
                    class="icon-[fe--list-bullet] size-3.5 text-gray-400"
                    aria-label="has checklist"
                  ></span>
                {/if}
              </div>
            {/if}
            {#if todo.planned}
              <span class="ml-auto flex shrink-0 items-center pl-2">
                <span
                  class="rounded bg-black/10 px-1.5 py-0.5 text-[11px] font-medium text-gray-500"
                  aria-label="planned"
                >
                  {formatPlannedShort(todo.planned as CalendarDate)}
                </span>
              </span>
            {/if}
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
