<script module>
  import { createContext } from "svelte";
  import Popup from "./Popup.svelte";

  type PopupArg = {
    anchor: HTMLElement;
    getProjIdShown: () => string;
    showProject: (projId: string) => void;
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
  import { detectHoverOnce, type ProjectItem } from "$lib";
  import { getAppState } from "$lib/client/context";

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();
  let popup: Popup<PopupArg> | undefined;

  const appState = getAppState();
  let projects = $derived(appState.projects);

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
  {#snippet content({ getProjIdShown, showProject }: PopupArg)}
    {@const listShownId = getProjIdShown()}
    <div
      class="max-h-120 w-90 overflow-hidden overflow-y-auto overscroll-contain rounded-md border border-gray-300 bg-[#f2f3f5] p-2 shadow-[0_8px_15px_rgba(0,0,0,0.1)]"
      {@attach detectHoverOnce("target-to-hover", (el) => el.classList.add("target-hovered"))}
    >
      {#each projects as proj (proj.id)}
        <button
          class={[
            "target-to-hover flex h-7 w-full cursor-default items-center rounded-sm px-2 select-none hover:bg-pink-200",
            listShownId === proj.id && "not-in-[.target-hovered]:bg-pink-200",
          ]}
          onclick={() => {
            showProject(proj.id);
            popup?.close();
          }}
        >
          <div class="flex flex-1 overflow-hidden text-sm">
            <span class="truncate">{proj.name || "New ProjectItem"}</span>
          </div>
          {#if listShownId === proj.id}
            <span class="icon-[qlementine-icons--check-tick-24] block size-5 shrink-0 text-teal-600"
            ></span>
          {/if}
        </button>
      {/each}
    </div>
  {/snippet}
</Popup>
