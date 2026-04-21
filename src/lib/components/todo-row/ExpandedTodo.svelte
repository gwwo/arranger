<script lang="ts" module>
  import { useCreateCheck, useEditTodo } from "$lib/client/mutate-remote";

  const useMutator = () => ({
    editTodo: useEditTodo(),
    createCheck: useCreateCheck(),
  });
  type Mutator = ReturnType<typeof useMutator>;
</script>

<script lang="ts">
  import {
    Inputbar,
    Input,
    usePicker,
    type PickerPopupArg,
    placeholder,
    newCheckItem,
    slideFly,
  } from "$lib";
  import type { CheckItem, TodoItem } from "$lib";
  import {
    getMonthName,
    listDaysOfWeek,
    getToday,
    getDayOfW,
  } from "$lib/components/calendar/utils";
  import type { CalendarDate } from "@internationalized/date";
  import { onMount, tick, untrack } from "svelte";
  import { slide } from "svelte/transition";
  import CheckList, { type CheckToFocus } from "../check-list/CheckList.svelte";
  import type { ReadonlyDeep } from "$lib/utils/type-gymnastics";
  type Props = {
    todo: ReadonlyDeep<TodoItem>;
    mut?: Mutator;
  };

  let { todo, mut = useMutator() }: Props = $props();

  let titleInput: Input | null = null;
  let noteInput: Input;

  export const focusTitleInput = () => titleInput?.setCaretPosition("end");

  const picker = usePicker();

  let arg: PickerPopupArg | undefined = $state.raw();
  let plannedExpanded = $state(false);

  let plannedInput: string = $state("");

  $effect(() => {
    if (arg && plannedExpanded && arg !== picker.getCurrentArg()) {
      setTimeout(() => {
        plannedExpanded = false;
        plannedInput = "";
      });
    }
  });
  const getDate = () => todo.planned as CalendarDate;

  const setDate = (planned: CalendarDate) => mut.editTodo({ planned });

  const formatplanned = (planned: CalendarDate) => {
    const month = getMonthName(planned.month).slice(0, 3);
    const { day } = planned;
    if (planned.year === getToday().year) {
      const weekday = getDayOfW(planned);
      const weekdayLabel = weekday[0].toUpperCase() + weekday.slice(1);
      return `${weekdayLabel}, ${month} ${day}`;
    }
    return `${day} ${month} ${planned.year}`;
  };

  const onExpand = (anchor: HTMLElement) => {
    arg = {
      anchor,
      getDate,
      setDate,
      getInput: () => plannedInput,
    };
    picker.popup(arg);
  };

  let plannedBadge: HTMLElement | undefined = $state.raw();

  let checkToFocus: CheckToFocus | null = $state.raw(null);
</script>

<Input
  bind:this={titleInput}
  bind:value={() => todo.title, (v) => (v !== todo.title ? mut.editTodo({ title: v }) : null)}
  updateOnBlur
  placeholder={placeholder.todo.title}
  class="min-h-6 wrap-break-word"
  onkeydown={(ev: KeyboardEvent) => {
    if (ev.key === "Enter") ev.preventDefault();
  }}
  onNavigateOut={(direction, preferredX, ev) => {
    ev.preventDefault();
    if (direction == "down") {
      noteInput?.moveCaretToX(preferredX, "top");
    }
  }}
></Input>

<Input
  bind:this={noteInput}
  bind:value={() => todo.note, (v) => (v !== todo.note ? mut.editTodo({ note: v }) : null)}
  updateOnBlur
  placeholder={placeholder.todo.note}
  class="mt-2 min-h-12 wrap-break-word"
  onNavigateOut={(direction, preferredX, ev) => {
    ev.preventDefault();
    if (direction == "up") {
      titleInput?.moveCaretToX(preferredX, "bottom");
    } else {
      checkToFocus = { index: 0, moveTo: { preferredX, near: "top" } };
    }
  }}
></Input>

{#if todo.checks.length > 0}
  <div
    class="h-fit w-full"
    in:slideFly={{ axis: "y", duration: 250, x: 40 }}
    out:slideFly={{ axis: "y", duration: 200, x: 40 }}
  >
    <div class="py-3">
      <CheckList
        data={todo.checks as CheckItem[]}
        {checkToFocus}
        onNavigateOut={(direction, preferredX, ev) => {
          ev.preventDefault();
          if (direction == "up") {
            noteInput?.moveCaretToX(preferredX, "bottom");
          }
        }}
      ></CheckList>
    </div>
  </div>
{/if}

{#if todo.planned}
  <div
    class="h-fit w-full"
    in:slideFly={{ axis: "y", duration: 250, x: 40 }}
    out:slideFly={{ axis: "y", duration: 200, x: 40 }}
  >
    <div class="pt-2">
      <div
        bind:this={plannedBadge}
        class={[
          "flex w-fit items-center rounded-md  text-gray-600",
          "group border border-transparent hover:border-gray-200 active:border-gray-300",
        ]}
      >
        <button
          class="flex h-6 items-center gap-1 pr-1 pl-2 text-sm font-medium"
          aria-label="to pick another planned"
          onclick={(ev) => {
            const anchor = ev.currentTarget;
            picker.popup({ anchor, getDate, setDate, getInput: () => "" });
          }}
        >
          <span class="icon-[fluent--calendar-32-regular] scale-120 text-pink-500"></span>
          <p class="">{formatplanned(todo.planned as CalendarDate)}</p>
        </button>
        <button
          class="flex size-6 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-gray-200"
          aria-label="to clear the planned"
          onclick={(ev) => {
            mut.editTodo({ planned: null });
          }}
        >
          <span class="icon-[ic--round-close]"></span>
        </button>
      </div>
    </div>
  </div>
{/if}

<div class="mt-2 flex h-8 w-full items-center justify-end">
  {#if todo.checks.length === 0}
    <div class="flex-none" in:slideFly={{ axis: "x", duration: 250 }}>
      <Inputbar
        placeholder="Checklist"
        class="icon-[cil--list] scale-75"
        bind:text={
          () => "" as string,
          (val) => {
            const checks = val.split(/\r\n|\r|\n/).map((text) => ({ text }));
            mut.createCheck(checks, 0).then(() => {
              checkToFocus = { index: checks.length - 1 };
            });
          }
        }
      />
    </div>
  {/if}
  {#if todo.planned == null}
    <div class="flex-none" in:slideFly={{ axis: "x", duration: 250 }}>
      <div class="pl-2">
        <Inputbar
          placeholder="When"
          bind:text={plannedInput}
          bind:expanded={plannedExpanded}
          class="icon-[fluent--calendar-32-regular] scale-90"
          {onExpand}
        />
      </div>
    </div>
  {/if}
</div>
