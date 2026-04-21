<script module>
  import { createContext } from "svelte";
  import Popup from "./Popup.svelte";
  import { type TodoItem, type RowItem, Calendar } from "$lib";
  import { getDayOfWeek, type CalendarDate } from "@internationalized/date";

  export type PopupArg = {
    anchor: HTMLElement;
    getDate?: () => CalendarDate | null;
    setDate?: (d: CalendarDate) => void;
    getInput: () => string;
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
</script>

{@render children()}

<Popup bind:this={popup} alignX="left" retainAnchorClick>
  {#snippet content({ getDate, setDate, getInput }: PopupArg)}
    {@const input = getInput()}
    <div class="w-fit overflow-hidden rounded-md bg-[#2d3238] p-2">
      {#if input !== ""}
        {@const results = parse(input)}
        <div class="text-sm text-white" style:width="{calendarWidth}px">
          {#each results as [l, r]}
            <div class="flex h-7 items-center gap-2 overflow-hidden">
              <div class="min-w-[30%] flex-1 truncate">
                {l}
              </div>
              <div class="truncate overflow-hidden">
                {r}
              </div>
            </div>
          {/each}
          {#if results.length === 0}
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
    </div>
  {/snippet}
</Popup>
