<script module>
  import { createContext } from "svelte";
  import Popup from "./Popup.svelte";
  import { type TodoItem, type RowItem, Calendar } from "$lib";
  import { getDayOfWeek, type CalendarDate } from "@internationalized/date";

  export type PopupArg = {
    anchor: HTMLElement;
    getDate?: () => CalendarDate | null;
    setDate?: (d: CalendarDate) => void;
    getInput?: () => string;
  };

  type Picker = {
    popup: (arg: PopupArg) => void;
    getCurrentArg: () => PopupArg | null;
  };

  const [usePicker, setPicker] = createContext<Picker>();
  export { usePicker };

  const [usePickerScrollCanceller, setPickerScrollAttachment] =
    createContext<Attachment<HTMLElement>>();
  export { usePickerScrollCanceller };
</script>

<script lang="ts">
  import { parse } from "$lib/date-parse";
  import type { Snippet } from "svelte";
  import type { Attachment } from "svelte/attachments";

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();
  let popup: Popup<PopupArg> | undefined = $state.raw();

  setPicker({
    popup: (arg) => {
      if (popup?.getCurrentArg()?.anchor !== arg.anchor) {
        popup?.show(arg);
      }
    },
    getCurrentArg: () => popup?.getCurrentArg() ?? null,
  });

  setPickerScrollAttachment((node) => {
    $effect(() => {
      const arg = popup?.getCurrentArg();
      if (arg == undefined || !node.contains(arg.anchor)) return;
      const handler = () => popup?.close();
      node.addEventListener("scroll", handler);
      return () => node.removeEventListener("scroll", handler);
    });
  });

  const cellSize = 30;
  const gapWidth = 1;
  const calendarWidth = cellSize * 7 + gapWidth * 6;

  let internalInput = $state("");

  $effect(() => {
    const arg = popup?.getCurrentArg();
    if (arg && !arg.getInput) internalInput = "";
  });

  const getEffectiveInput = (arg: PopupArg) =>
    arg.getInput ? arg.getInput() : internalInput;

  let pickerResults = $derived.by(() => {
    const arg = popup?.getCurrentArg();
    if (!arg) return [];
    const input = getEffectiveInput(arg);
    return input === "" ? [] : parse(input);
  });
  let selectedIndex = $state(0);

  $effect(() => {
    pickerResults;
    selectedIndex = 0;
  });

  $effect(() => {
    if (pickerResults.length === 0) return;
    const arg = popup?.getCurrentArg();
    if (!arg) return;
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        selectedIndex = (selectedIndex + 1) % pickerResults.length;
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        selectedIndex = (selectedIndex - 1 + pickerResults.length) % pickerResults.length;
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        arg.setDate?.(pickerResults[selectedIndex].d);
        popup?.close();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  });
</script>

{@render children()}

<Popup bind:this={popup} alignX="left" retainAnchorClick>
  {#snippet content({ getDate, setDate, getInput }: PopupArg)}
    {@const input = getInput ? getInput() : internalInput}
    {@const showInternalInput = !getInput}
    {@const inputAtBottom = popup?.getAlignY() === "top"}
    <div class="flex w-fit flex-col overflow-hidden rounded-md bg-[#2d3238] p-2">
      {#if showInternalInput && !inputAtBottom}
        {@render internalInputBar()}
      {/if}
      {#if input !== ""}
        {@const chosen = getDate?.()}
        <div class="text-sm text-white" style:width="{calendarWidth}px">
          {#each pickerResults as { d, l, r }, i}
            {@const isChosen = chosen != null && d.compare(chosen) === 0}
            {@const isSelected = i === selectedIndex}
            <button
              class={[
                "flex h-7 w-full items-center gap-2 overflow-hidden rounded-sm px-1",
                "cursor-default text-left select-none",
                isChosen ? "bg-[#6a97f8]" : isSelected ? "bg-[#4f555d]" : "",
              ]}
              onmouseenter={() => (selectedIndex = i)}
              onclick={() => {
                setDate?.(d);
                popup?.close();
              }}
            >
              <div class="min-w-[30%] flex-1 truncate">
                {l}
              </div>
              <div class="truncate overflow-hidden">
                {r}
              </div>
            </button>
          {/each}
          {#if pickerResults.length === 0}
            <div class="flex h-12 items-center justify-center">No Results</div>
          {/if}
        </div>
      {:else}
        <Calendar
          {cellSize}
          {gapWidth}
          dateChosen={getDate?.() ?? undefined}
          onChoose={(date) => {
            setDate?.(date);
            popup?.close();
          }}
        ></Calendar>
      {/if}
      {#if showInternalInput && inputAtBottom}
        {@render internalInputBar()}
      {/if}
    </div>
  {/snippet}
</Popup>

{#snippet internalInputBar()}
  {@const inputAtBottom = popup?.getAlignY() === "top"}
  <input
    {@attach (el) => {
      (el as HTMLInputElement).focus();
    }}
    bind:value={internalInput}
    type="text"
    placeholder="When"
    class={[
      "h-7 rounded-sm bg-[#3a4047] px-2 text-sm text-white",
      "placeholder:text-[#c5c9cf] focus:outline-none",
      inputAtBottom ? "mt-2" : "mb-2",
    ]}
    style:width="{calendarWidth}px"
    onkeydown={(ev) => {
      if (ev.key === "Escape") popup?.close();
    }}
  />
{/snippet}
