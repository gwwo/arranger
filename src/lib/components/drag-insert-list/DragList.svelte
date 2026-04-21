<script lang="ts" module>
  import type { Snippet } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import type { Insertable, InsertPreview, IntroTransition } from "./utils";
  import type { Inserter, Insertion, Target } from "./InsertPile.svelte";
  import { type ReadonlyDeep } from "$lib/utils/type-gymnastics";
  type InsertOption = {
    index: number;
    insertTop: number;
    blockMoveDown: number;
    borderNext?: number;
  };

  export type DragPrep<ItemInsert, InsertInfo> = {
    items: ItemInsert[];
    anchorId: string;
    mouseDown: {
      x: number;
      y: number;
    };
    condition: (dx: number, dy: number) => boolean;
    info: InsertInfo;
  };

  export type TargetPrep<TargetInfo> = Omit<Target<TargetInfo>, "toComponentId">;

  export type Props<Item, ItemInsert, InsertInfo, TargetInfo> = {
    data: Item[];
    row: Snippet<
      [
        items: Item[],
        item: Item,
        index: number,
        prepare: (dragPrep: DragPrep<ItemInsert, InsertInfo>) => void,
        phantomIndex: number | undefined,
      ]
    >;
    phantom: Snippet;
    onInsertActive: (
      items: ItemInsert[],
      toRender: Item[],
      toDerender: Item[],
    ) => { insertables: Insertable[]; heights?: Map<string, number> };
    onInsertTargeted: (
      index: number,
      insertion: Insertion<ItemInsert, InsertInfo>,
      node: HTMLDivElement,
    ) => TargetPrep<TargetInfo>;
    getMarginTop: (pre: Item | null, cur: Item | null) => number;
    transitionMarginTop?: boolean;
    noDragOut?: boolean;
    allowInsert: "all" | "self";
    transitionRearrange: "data-change" | "internal-guesture";
    class?: string | (string | false | undefined)[];
    useInserter: () => Inserter<ItemInsert, InsertInfo, TargetInfo>;
    phantomHeight?: "first" | "maximum";
  } & SvelteHTMLElements["div"];
</script>

<script
  lang="ts"
  generics="Item extends {id: string}, ItemInsert extends {id: string}, InsertInfo, TargetInfo"
>
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { fade, fly, scale, slide } from "svelte/transition";
  import { useInsertListYProvider } from "./utils.svelte";

  import { calcInsertMoves, reorder } from "./utils";
  import { getLayoutRect } from "$lib/utils/dom";
  import type { SvelteHTMLElements } from "svelte/elements";
  import { derived } from "svelte/store";
  import type { InsertInfo } from "../check-list/CheckListInsert.svelte";

  let {
    data,
    noDragOut = false,
    transitionMarginTop = false,
    allowInsert,
    transitionRearrange,
    onInsertActive,
    getMarginTop,
    row,
    phantom,
    class: panelClass,
    useInserter,
    onInsertTargeted,
    phantomHeight = "first",
    ...restProps
  }: Props<Item, ItemInsert, InsertInfo, TargetInfo> = $props();
  const componentID = $props.id();

  const elements: { [key: string]: HTMLElement | undefined | null } = {};

  const associate = (id: string): Attachment<HTMLElement> => {
    return (node) => {
      elements[id] = node;
      return () => delete elements[id];
    };
  };

  const { register, receive, getInsertion, getPileComfinedOffsetTop, setTarget, getTarget } =
    useInserter();

  let insertion = $derived.by(() => {
    const insertion = getInsertion();
    if (allowInsert === "all") return insertion;
    if (allowInsert === "self" && insertion?.fromComponentId === componentID) {
      return insertion;
    }
  });

  // fixed once initialized, for state consistency since setTimeout is used.
  const transRearrange = transitionRearrange;
  const transRearrangeLimit = 600;
  const transRearrangeDuration = 300;

  type RearrangeMotion = {
    timing: "data-change" | "internal-guesture" | "never";
    itemLimit: number;
    duration: number;
  };

  let enableTransRearrange = $state(transRearrange === "data-change");
  let instantIntro = $derived(enableTransRearrange === false || data.length > transRearrangeLimit);
  let instantReorder = $derived(
    enableTransRearrange === false || data.length > transRearrangeLimit,
  );

  // mutate instantInro and instantReorder only in here
  if (transRearrange === "internal-guesture") {
    $effect.pre(() => {
      if (insertion?.fromComponentId === componentID) {
        enableTransRearrange = true;
      }
      if (insertion == null) {
        const timertid = setTimeout(() => {
          enableTransRearrange = false;
        }, 300);
        return () => clearTimeout(timertid);
      }
    });
  }

  let suppressMarginTransition = $state(false);
  const transMarginTop = transitionMarginTop;
  if (transMarginTop) {
    $effect.pre(() => {
      if (insertion) {
        untrack(() => (suppressMarginTransition = true));
      } else {
        tick().then(() => (suppressMarginTransition = false));
      }
    });
  }

  let panel: HTMLDivElement | undefined = $state.raw();
  let contentEl: HTMLDivElement | null = $state.raw(null);

  let panelLayoutRect: DOMRect | undefined = $state.raw();

  const getComfine = () => panelLayoutRect;
  const setComfine = () => {
    if (panel) panelLayoutRect = getLayoutRect(panel);
  };

  let insertWithComfine = $derived(insertion?.getComfine === getComfine);
  $effect(() => {
    if (insertWithComfine) {
      window.addEventListener("scroll", setComfine);
      window.addEventListener("resize", setComfine);
      return () => {
        window.removeEventListener("scroll", setComfine);
        window.removeEventListener("resize", setComfine);
      };
    }
  });

  let panelRect: DOMRect | undefined = $state.raw();
  // the timing of getBoundingClientRect would be deferred when running in onMount,
  // which would leads to a wrong rect
  $effect.pre(() => {
    if (panel == null) return;
    if (insertion) {
      const rect = panel.getBoundingClientRect();
      panelRect = rect;
      panel.style.height = `${rect.height}px`;
      panel.style.width = `${rect.width}px`;
    } else {
      panel.style.height = "";
      panel.style.width = "";
      // calling `getBoundingClientRect` here would cause jitter in safari
      // when inserting a multiline check item to a checklist.
      // The jitter also occurs when the insertion change checklist height in some sense. but won't be relevant in our design case.
      // any case, it is also not correct mesureing if the insertion will change the rect height.
      // better way to measure panelRect for insertion animation?
      // panelRect = panel.getBoundingClientRect();
    }
  });

  // auto scroll keeps firing when h-auto?
  const provider = useInsertListYProvider(() => insertion != undefined);

  // only keep the elements of `itemsToRender` that are within a 30-count radius of
  // the element with item.id === anchorId; and the first 30-count of elements
  const trim = (itemsToDrag: ItemInsert[], anchorId: string) => {
    const anchorIdx = itemsToDrag.findIndex(({ id }) => id === anchorId);
    const range = 30;
    const keep = new Set<number>();
    const headCount = Math.min(itemsToDrag.length, 30);
    for (let i = 0; i < headCount; i++) keep.add(i);
    if (anchorIdx >= 0) {
      const start = Math.max(0, anchorIdx - range);
      const end = Math.min(itemsToDrag.length - 1, anchorIdx + range);
      for (let i = start; i <= end; i++) keep.add(i);
    }
    return itemsToDrag.filter((_, idx) => keep.has(idx));
  };

  function prepare(dragPrep: DragPrep<ItemInsert, InsertInfo>) {
    const { items, anchorId, mouseDown, condition, info } = dragPrep;
    const anchorEl = elements[anchorId];
    if (anchorEl == null) return;
    const { left, top, width } = anchorEl.getBoundingClientRect();

    const itemsToDrag = items;

    const initiate = (): Insertion<ItemInsert, InsertInfo> | undefined => {
      const mouseDownOffset = {
        x: mouseDown.x - left,
        y: mouseDown.y - top,
      };

      if (itemsToDrag.length === 0) return;

      const itemIds = itemsToDrag.reduce((ids, { id }) => {
        ids.add(id);
        return ids;
      }, new Set() as Set<string>);

      let height = 0;
      const itemsToRender = trim(itemsToDrag, anchorId).flatMap((item) => {
        const rect = elements[item.id]?.getBoundingClientRect();
        if (rect == null) return [];
        if (
          (phantomHeight === "first" && height === 0) ||
          (phantomHeight === "maximum" && rect.height > height)
        ) {
          height = rect.height;
        }
        return [{ item, offsetTop: rect.top - top }];
      });

      return {
        items: itemsToDrag,
        itemIds,
        itemsToRender,
        pile: { width, height, mouseDownOffset },
        fromComponentId: componentID,
        getComfine: noDragOut ? (setComfine(), getComfine) : undefined,
        info,
      };
    };

    register({ mouseDown, condition, initiate });
  }

  let dataToRender: Item[] = $state(data);
  let insertOptions: InsertOption[] | null = $state(null);

  $effect.pre(() => {
    insertion;
    data;
    untrack(() => {
      [dataToRender, insertOptions] = handleInsertActive();
    });
  });

  function handleInsertActive(): [Item[], InsertOption[] | null] {
    if (insertion == null) {
      return [data, null];
    }

    const { items, itemIds, pile } = insertion;
    const [toRender, toDerender] = data.reduce(
      ([pass, fail], item) => {
        if (!itemIds.has(item.id)) pass.push(item);
        else fail.push(item);
        return [pass, fail];
      },
      [[], []] as [Item[], Item[]],
    );

    const { insertables, heights } = onInsertActive(items, toRender, toDerender);

    const previews: (InsertPreview & { index: number })[] = [];

    const len = toRender.length;

    const measure = (i: number) => {
      const cur = toRender[i];
      const mt = getMarginTop(toRender[i - 1] ?? null, cur);
      const h = heights?.get(cur.id) ?? elements[cur.id]?.getBoundingClientRect().height ?? 0;
      return { mt, h };
    };

    let i = 0;
    let lastBlockBottom = 0;

    for (const { index, spacePrecede, spaceFollow } of insertables) {
      while (i < index && i < len) {
        const { mt, h } = measure(i);
        lastBlockBottom += mt + h;
        i++;
      }
      if (i !== index) continue; // i in [0, len]
      const { mt, h } = i < len ? measure(i) : { mt: 0, h: 0 };
      const precedeBlockBottom = lastBlockBottom;
      const followBlockTop = precedeBlockBottom + mt;
      const insertTop = precedeBlockBottom + spacePrecede;

      previews.push({
        index,
        precedeBlockBottom,
        followBlockTop,
        insertTop,
        spaceFollow,
      });

      lastBlockBottom = followBlockTop + h;
      i += 1; // i is strictly increasing for each `i === index` path
      if (i > len) break;
    }

    const moves = calcInsertMoves(previews, pile.height);

    const options = moves.map((mv, i) => {
      const { index, insertTop } = previews[i];
      return { index, insertTop, ...mv };
    });

    return [toRender, options];
  }

  const getYComfined = () => {
    const topGap = getPileComfinedOffsetTop();
    const scrollTop = provider.getScrollTop();
    if (topGap == null || scrollTop == null) return;
    return topGap + scrollTop;
  };
  const getYFree = () => {
    const insertY = provider.getInsertY();
    if (insertY == null || insertion == null) return;
    return insertY - insertion.pile.mouseDownOffset.y;
  };
  let phantomInsert: InsertOption | undefined = $derived.by(() => {
    if (insertOptions == null) return;
    const Y = insertWithComfine ? getYComfined() : getYFree();
    if (Y == null) return;
    return insertOptions.find(({ borderNext }) => borderNext == null || borderNext > Y);
  });

  let bottomSpacerH = $derived.by(() => {
    const pre = dataToRender[dataToRender.length - 1];
    return getMarginTop(pre, null) + (phantomInsert?.blockMoveDown ?? 0);
  });

  $effect.pre(() => {
    if (insertion == undefined) return;
    // setTarget when phantomInsert changes
    if (phantomInsert == undefined) {
      if (componentID === getTarget()?.toComponentId) {
        setTarget(null);
      }
      return;
    }
    if (contentEl == null) return;
    const prep = onInsertTargeted(phantomInsert.index, insertion, contentEl);

    setTarget({
      toComponentId: componentID,
      ...prep,
    });
  });
</script>

<div
  bind:this={panel}
  {@attach provider.setup}
  {...restProps}
  class={[panelClass, "relative"]}
  style:scrollbar-gutter="stable"
  style:padding-top="0"
  style:padding-bottom="0"
>
  <!-- use flex to make the margin-top not cascading -->
  <div bind:this={contentEl} class="relative flex h-fit w-full flex-col">
    {#if phantomInsert != undefined && insertion != undefined}
      <!-- using transition:scale={{ duration: 200, start: 0.5 }} 
     will mess up translateY transition in safari; so go back to transition style:top -->
      <!-- positioned against panel, so that margin collapsing of the first item will be accounted for. -->
      <div
        transition:scale={{ duration: 200, start: 0.5 }}
        class="pointer-events-none absolute top-0 left-[50%] w-full duration-100"
        style:height="{insertion.pile.height}px"
        style:top="{phantomInsert.insertTop}px"
        style:transform="translate(-50%)"
      >
        {@render phantom()}
      </div>
    {/if}
    {#each dataToRender as item, index (item.id)}
      {@const translateY =
        phantomInsert != undefined && phantomInsert.index <= index
          ? (phantomInsert.blockMoveDown ?? 0)
          : 0}
      {@const marginTop = getMarginTop(dataToRender[index - 1] ?? null, item)}
      {@const intro: IntroTransition = (node) => (instantIntro ? {} :receive(node, { key: `${componentID}//${item.id}` }) ) }
      <div
        {@attach associate(item.id)}
        in:intro
        animate:reorder={{ translateY, panelRect, shortcut: instantReorder }}
        class={[
          "relative",
          !transitionMarginTop || suppressMarginTransition
            ? !instantReorder && "trans-transform"
            : instantReorder
              ? "trans-margin"
              : "trans-both",
        ]}
        style:margin-top="{marginTop}px"
        style:transform="translateY({translateY}px)"
      >
        {@render row(dataToRender, item, index, prepare, phantomInsert?.index)}
      </div>
    {/each}
    <div class="w-full" style:height="{bottomSpacerH}px"></div>
  </div>
</div>

<style>
  .trans-transform {
    transition: transform 200ms linear;
  }
  .trans-margin {
    transition: margin 300ms ease;
  }
  .trans-both {
    transition:
      transform 200ms linear,
      margin 300ms ease;
  }
</style>
