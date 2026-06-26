<script module>
  import { createContext } from "svelte";
  import Popup from "./Popup.svelte";
  import type { OperationInstance } from "$lib/client/model";

  type Selection =
    | { kind: "project"; id: string }
    | { kind: "operation"; value: OperationInstance };

  type PopupArg = {
    anchor: HTMLElement;
    getCurrent: () => Selection;
    showProject: (projId: string) => void;
    showOperation: (op: OperationInstance) => void;
  };

  type Switcher = {
    popup: (arg: PopupArg) => void;
  };

  const [useSwitcher, setSwitcher] = createContext<Switcher>();
  export { useSwitcher };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import { detectHoverOnce, placeholder, type ProjectItem } from "$lib";
  import { getAppState } from "$lib/client/context";
  import { operations } from "$lib/components/operation-list/OperationList.svelte";

  const accountEntry: { value: OperationInstance; iconClass: string } = {
    value: "account",
    iconClass: "icon-[mdi--user] text-gray-600",
  };

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();
  let popup: Popup<PopupArg> | undefined;

  const appState = getAppState();
  // Hide projects only open from a placement view (not active list projects).
  let projects = $derived(appState.projects.filter((p) => !appState.openProjPlacement.has(p.id)));

  const labelFromOperation = (value: OperationInstance) =>
    value.charAt(0).toUpperCase() + value.slice(1);

  // Scrolls the popup's scroll container so the selected button is centered.
  // Operating directly on offsetTop scopes the scroll to the list container
  // — `scrollIntoView` would also nudge ancestor scrollers like the page.
  const scrollSelectedIntoView = (selected: boolean) => (node: HTMLElement) => {
    if (!selected) return;
    requestAnimationFrame(() => {
      const container = node.parentElement;
      if (!container) return;
      const target = node.offsetTop - (container.clientHeight - node.offsetHeight) / 2;
      container.scrollTop = Math.max(0, target);
    });
  };

  setSwitcher({
    popup: (arg) => {
      if (popup?.getCurrentArg()?.anchor !== arg.anchor) {
        popup?.show(arg);
      }
    },
  });
</script>

{@render children()}

<Popup bind:this={popup} alignY="bottom">
  {#snippet content({ getCurrent, showProject, showOperation }: PopupArg)}
    {@const current = getCurrent()}
    <div
      class="max-h-120 w-90 overflow-hidden overflow-y-auto overscroll-contain rounded-md border border-gray-300 bg-[#f2f3f5] p-2 shadow-[0_8px_15px_rgba(0,0,0,0.1)]"
      {@attach detectHoverOnce("target-to-hover", (el) => el.classList.add("target-hovered"))}
    >
      {#each operations as op (op.value)}
        {@const opSelected = current.kind === "operation" && current.value === op.value}
        <button
          class={[
            "target-to-hover flex h-7 w-full cursor-default items-center gap-2 rounded-sm px-2 select-none hover:bg-pink-200",
            opSelected && "not-in-[.target-hovered]:bg-pink-200",
          ]}
          onclick={() => {
            showOperation(op.value);
            popup?.close();
          }}
          {@attach scrollSelectedIntoView(opSelected)}
        >
          <span class={[op.iconClass, "size-4.5 shrink-0"]}></span>
          <div class="flex flex-1 overflow-hidden text-sm">
            <span class="truncate">{labelFromOperation(op.value)}</span>
          </div>
          {#if opSelected}
            <span class="icon-[qlementine-icons--check-tick-24] block size-5 shrink-0 text-teal-600"
            ></span>
          {/if}
        </button>
      {/each}
      {#if projects.length > 0}
        <div class="my-1 border-t border-gray-300"></div>
      {/if}
      {#each projects as proj (proj.id)}
        {@const projSelected = current.kind === "project" && current.id === proj.id}
        <button
          class={[
            "target-to-hover flex h-7 w-full cursor-default items-center rounded-sm px-2 select-none hover:bg-pink-200",
            projSelected && "not-in-[.target-hovered]:bg-pink-200",
          ]}
          onclick={() => {
            showProject(proj.id);
            popup?.close();
          }}
          {@attach scrollSelectedIntoView(projSelected)}
        >
          <div class="flex flex-1 overflow-hidden text-sm">
            <span class={["truncate", !proj.name && "text-gray-400"]}>
              {proj.name || placeholder.project.name}
            </span>
          </div>
          {#if projSelected}
            <span class="icon-[qlementine-icons--check-tick-24] block size-5 shrink-0 text-teal-600"
            ></span>
          {/if}
        </button>
      {/each}
      <div class="my-1 border-t border-gray-300"></div>
      {#if true}
        {@const accountSelected =
          current.kind === "operation" && current.value === accountEntry.value}
        <button
          class={[
            "target-to-hover flex h-7 w-full cursor-default items-center gap-2 rounded-sm px-2 select-none hover:bg-pink-200",
            accountSelected && "not-in-[.target-hovered]:bg-pink-200",
          ]}
          onclick={() => {
            showOperation(accountEntry.value);
            popup?.close();
          }}
          {@attach scrollSelectedIntoView(accountSelected)}
        >
          <span class={[accountEntry.iconClass, "size-4.5 shrink-0"]}></span>
          <div class="flex flex-1 overflow-hidden text-sm">
            <span class="truncate">{labelFromOperation(accountEntry.value)}</span>
          </div>
          {#if accountSelected}
            <span class="icon-[qlementine-icons--check-tick-24] block size-5 shrink-0 text-teal-600"
            ></span>
          {/if}
        </button>
      {/if}
    </div>
  {/snippet}
</Popup>
