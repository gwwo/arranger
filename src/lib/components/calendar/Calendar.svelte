<script lang="ts">
  import { fade, slide } from "svelte/transition";
  import { today, getLocalTimeZone, CalendarDate } from "@internationalized/date";
  import { useScrollTopBind, useScrollingTrack } from "./utils.svelte";
  import { type MonthGrid, useCalendar, getMonthName, listDaysOfWeek } from "./utils";

  const weekLength = listDaysOfWeek.length;

  const segmentColor = "#99a1af";
  const bottomBarHeight = 20;

  type Props = {
    dateChosen?: { day: number; month: number; year: number };
    dateToday?: CalendarDate;
    onChoose?: (date: CalendarDate) => void;
    cellSize?: number; // in px
    gapWidth?: number; // in px
  };

  let {
    dateToday: dateTodayPassed = today(getLocalTimeZone()),
    dateChosen,
    onChoose,
    cellSize: cellSizePassed = 30,
    gapWidth: gapWidthPassed = 1,
  }: Props = $props();

  // the layout won't be reactive once initialized
  const cellSize = cellSizePassed;
  const gapWidth = gapWidthPassed;
  const cellSizeWithGap = cellSize + gapWidth;
  // so is dateTodayPassed
  const dateToday = dateTodayPassed;
  const { getMonthsToCover, dateMonthZeroWeekIndex, dateLastWeekIndex } = useCalendar(
    dateToday,
    500,
  );

  const containerHeight = cellSizeWithGap * 8;
  const scrollHeight = cellSizeWithGap * (dateLastWeekIndex + 1) - gapWidth;

  const calcTop = (weekIndex: number) =>
    cellSizeWithGap * weekIndex - (weekIndex !== 0 ? gapWidth : 0);

  const scrollTopToday = calcTop(dateMonthZeroWeekIndex);

  const { doScroll, isScrolling, isScrollingFar, stopScrollSoon } = useScrollingTrack(
    cellSizeWithGap * 10,
  );

  const { scrollTopBind, getScrollTop, scrollTopTo } = useScrollTopBind(
    scrollTopToday,
    (scrollTop) => doScroll(scrollTop),
  );

  const scrollTopDownFar = calcTop(dateMonthZeroWeekIndex + 20);
  const scrollTopUpFar = calcTop(dateMonthZeroWeekIndex - 20);
  let downAwayFromToday = $derived(getScrollTop() >= scrollTopDownFar);
  let upAwayFromToday = $derived(getScrollTop() <= scrollTopUpFar);

  const scrollBackToday = (ev: MouseEvent) => {
    if (!downAwayFromToday && !upAwayFromToday) return;
    ev.preventDefault();
    scrollTopTo([
      {
        top: downAwayFromToday ? scrollTopDownFar : scrollTopUpFar,
        instant: true,
      },
      { top: scrollTopToday },
    ]);
  };

  let renderedTop: number | undefined;
  let renderedBottom: number | undefined;

  const bufferHeight = cellSizeWithGap * 10;

  let weekRangeCached: { start: number; end: number } | undefined;
  let weekRange = $derived.by(() => {
    const scrollTop = getScrollTop();
    const safeZoneTop = Math.max(scrollTop - bufferHeight, 0);
    const safeZoneBottom = Math.min(scrollTop + containerHeight + bufferHeight, scrollHeight);
    const safeZoneInRendered =
      renderedTop &&
      safeZoneTop >= renderedTop &&
      renderedBottom &&
      safeZoneBottom <= renderedBottom;
    if (!safeZoneInRendered || weekRangeCached == undefined) {
      weekRangeCached = {
        // whhy `+ gapWidth`
        start: Math.ceil((safeZoneTop + gapWidth) / cellSizeWithGap),
        end: Math.ceil((safeZoneBottom + gapWidth) / cellSizeWithGap),
      };
    }
    return weekRangeCached;
  });

  let monthArr: MonthGrid[] = $derived.by(() => {
    const months = getMonthsToCover(weekRange.start, weekRange.end);
    [renderedTop, renderedBottom] =
      months.length === 0
        ? [undefined, undefined]
        : [months[0], months[months.length - 1]].map((m) => calcTop(m.weekIndex));
    return months;
  });
</script>

<!-- weekday header -->
<div
  class="pointer-events-none grid"
  style:grid-template-columns={`repeat(${weekLength}, 1fr)`}
  style:gap={`${gapWidth}px`}
>
  {#each listDaysOfWeek as str}
    <div
      class="flex h-6 items-center justify-center text-xs font-bold text-[#8c9299]"
      style:min-width={`${cellSize}px`}
      style:width={`${cellSize}px`}
    >
      {str.charAt(0).toUpperCase() + str.slice(1)}
    </div>
  {/each}
</div>

<div class="relative">
  <!-- scroll container -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    {@attach scrollTopBind}
    class={["no-scrollbar w-fit overflow-x-hidden overflow-y-scroll overscroll-contain"]}
    style:height={`${containerHeight}px`}
  >
    <div
      class="relative"
      style:height={`${scrollHeight + bottomBarHeight}px`}
      style:width={`${cellSizeWithGap * weekLength - gapWidth}px`}
    >
      {#each monthArr as mg (mg.weekIndex)}
        {@const hasTopGap = mg.weekIndex !== 0}
        {@const renderDaysPrecede = mg.weekIndex !== 0}
        {@const weeksInView = mg.nextWeekIndex - mg.weekIndex}
        {@const daysToRender =
          mg.weekIndex === dateLastWeekIndex ? 0 : weeksInView * weekLength - mg.daysPrecede}
        <!-- svelte-ignore a11y_mouse_events_have_key_events -->
        <div role="region" class="absolute" style:top={`${calcTop(mg.weekIndex)}px`}>
          {@render monthGrid(
            mg.daysPrecede,
            daysToRender,
            hasTopGap,
            renderDaysPrecede,
            mg.pre,
            mg.cur,
          )}
          {#if isScrolling() && daysToRender > 0}
            {@render monthIndicator(hasTopGap, weeksInView, mg.cur)}
          {/if}
        </div>
      {/each}
    </div>
  </div>
  <!-- bottom bar -->
  <div class="absolute inset-x-0 bottom-0 z-2 bg-[#2d3238]">
    <div
      class="pointer-events-none absolute inset-x-0 bottom-[100%] h-4 bg-gradient-to-b from-transparent to-[#2d3238]"
    ></div>
    {#if upAwayFromToday || downAwayFromToday}
      <button
        transition:slide
        class="group flex w-full cursor-default items-center justify-center select-none"
        onclick={scrollBackToday}
        onmousedown={(ev) => ev.preventDefault()}
        style:height={`${bottomBarHeight}px`}
      >
        <div class="flex items-center gap-1 rounded-sm px-2 text-white group-hover:bg-[#4e535b]">
          <span
            class={upAwayFromToday
              ? "icon-[icon-park-outline--down]"
              : "icon-[icon-park-outline--up]"}
          ></span>
          <span class="text-sm"> Back to Today </span>
        </div>
      </button>
    {/if}
  </div>
</div>

{#snippet monthGrid(
  daysPrecede: number,
  daysToRender: number,
  hasTopGap: boolean,
  renderDaysPrecede: boolean,
  pre: { month: number; year: number; days: number },
  cur: { month: number; year: number },
)}
  <div
    class={["grid transition-opacity", isScrolling() && "pointer-events-none opacity-50"]}
    style:grid-template-columns={`repeat(${weekLength}, 1fr)`}
    style:gap={`${gapWidth}px`}
  >
    {#if hasTopGap}
      <div
        class="relative h-0"
        style:grid-column={`${daysPrecede + 1} / span ${weekLength - daysPrecede}`}
      >
        {#if daysPrecede == 0 && daysToRender > 0}
          <div
            class="absolute top-0 right-0 left-0"
            style:border-bottom-width={`${gapWidth}px`}
            style:border-color={segmentColor}
          ></div>
        {/if}
      </div>
    {/if}

    {#if daysPrecede > 0}
      <div
        class="relative grid grid-cols-subgrid"
        style:grid-column={`1 / span ${daysPrecede}`}
        style:gap={`${gapWidth}px`}
      >
        {#if hasTopGap && daysToRender > 0}
          <div
            class="pointer-events-none absolute box-content rounded-br-md"
            style:bottom={`${-gapWidth}px`}
            style:right={`${-gapWidth}px`}
            style:width={`${cellSizeWithGap * daysPrecede - gapWidth}px`}
            style:height={`${cellSize * 0.6}px`}
            style:border-bottom-width={`${gapWidth}px`}
            style:border-right-width={`${gapWidth}px`}
            style:border-color={segmentColor}
          ></div>
          <div
            class="pointer-events-none absolute left-[100%] box-content rounded-tl-md"
            style:top={`${-gapWidth}px`}
            style:width={`${cellSizeWithGap * (weekLength - daysPrecede) - gapWidth}px`}
            style:height={`${cellSize * 0.6}px`}
            style:border-top-width={`${gapWidth}px`}
            style:border-left-width={`${gapWidth}px`}
            style:border-color={segmentColor}
          ></div>
        {/if}
        {#if renderDaysPrecede}
          {#each Array(daysPrecede)
            .fill(pre.days - daysPrecede + 1)
            .map((v, i) => v + i) as d}
            {@render cell(d, pre.month, pre.year)}
          {/each}
        {/if}
      </div>
    {/if}
    {#each Array.from({ length: daysToRender }, (_, i) => i + 1) as d}
      {@render cell(d, cur.month, cur.year)}
    {/each}
  </div>

  {#snippet cell(day: number, month: number, year: number)}
    {@const compare = (d: { day: number; month: number; year: number }) =>
      year - d.year || month - d.month || day - d.day}
    {@const compareToday = compare(dateToday)}
    {@const chosen = dateChosen && compare(dateChosen) == 0}
    <button
      class={[
        "flex w-full flex-col items-center justify-center rounded-md",
        "cursor-default text-white select-none",
        compareToday < 0 && "pointer-events-none opacity-50",
        chosen ? "bg-[#6a97f8]" : "hover:bg-[#4f555d]",
      ]}
      style:min-width={`${cellSize}px`}
      style:width={`${cellSize}px`}
      style:height={`${cellSize}px`}
      onclick={() => {
        onChoose?.(new CalendarDate(year, month, day));
      }}
    >
      {#if compareToday == 0}
        <span class="icon-[material-symbols--star-rounded] size-5"></span>
      {:else if day == 1 || chosen}
        <span class="text-xs font-semibold">{getMonthName(month).slice(0, 3)}</span>
        <span class="text-xs font-bold">{day}</span>
      {:else}
        <span class="text-sm font-semibold">{day}</span>
      {/if}
    </button>
  {/snippet}
{/snippet}

{#snippet monthIndicator(
  hasTopGap: boolean,
  weeksInView: number,
  cur: { month: number; year: number },
)}
  {@const weeksSkip = Math.ceil(weeksInView / 2 + 0.5) - 1}
  <div
    class="absolute inset-x-0 flex justify-center select-none"
    transition:fade
    style:top={`${cellSizeWithGap * weeksSkip + (hasTopGap ? gapWidth : 0)}px`}
  >
    <div
      class="relative flex items-center justify-center bg-[#2d3238]/80"
      style:height={`${cellSize}px`}
    >
      <div
        class="absolute inset-y-0 right-[100%] bg-gradient-to-r from-transparent from-0% to-[#2d3238]/80 to-90%"
        style:width={`${cellSize}px`}
      ></div>
      <div
        class="absolute inset-y-0 left-[100%] bg-gradient-to-l from-transparent from-0% to-[#2d3238]/80 to-90%"
        style:width={`${cellSize}px`}
      ></div>
      <p class="text-base font-semibold text-white">
        {getMonthName(cur.month)}
        {#if dateToday.year !== cur.year}
          <span class="ml-2">{cur.year}</span>
        {/if}
      </p>
    </div>
  </div>
{/snippet}
