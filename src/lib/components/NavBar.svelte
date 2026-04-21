<script lang="ts" module>
  export const MAX_PANEL_COUNT = 3;
</script>

<script lang="ts">
  import {
    useSwitcher,
    type ProjectItem,
    type PanelItem,
    newPanelItem,
    newProjectInstance,
    placeholder,
    isProjectInstance,
    type ProjectInstance,
    type Instance,
  } from "$lib";
  import { useClonePanel, useClosePanel, useSetProjInPanel } from "$lib/client/mutate-local";

  type Props = {
    isHomePanel: boolean;
    instance: Instance;
    swicherOpacity: number;
    opacityTransition: boolean;
    disable?: boolean;
  };

  let {
    isHomePanel,
    instance,
    swicherOpacity,
    disable = false,
    opacityTransition,
  }: Props = $props();

  const switcher = useSwitcher();

  const setProjInPanel = useSetProjInPanel();
  const closePanel = useClosePanel();
  const clonePanel = useClonePanel();

  const popup = (ev: MouseEvent & { currentTarget: EventTarget & HTMLElement }) => {
    if (disable) return;
    if (!isProjectInstance(instance)) return;
    const { project } = instance;
    switcher.popup({
      anchor: ev.currentTarget,
      getProjIdShown: () => project.id,
      showProject: setProjInPanel,
    });
  };
</script>

<div class="flex h-full items-center gap-2 px-4 pt-1 text-gray-400">
  <div class="size-5 flex-none">
    {#if isHomePanel}
      <button
        onclick={() => {}}
        class="flex size-full items-center justify-center"
        aria-label="to check sync info"
      >
        <span class="icon-[tabler--cloud-off] size-4.5"></span>
      </button>
    {:else}
      <button
        onclick={closePanel}
        class="group flex size-full items-center justify-center rounded-md hover:border hover:border-gray-400 active:bg-teal-400/20"
        aria-label="to close panel"
      >
        <!-- <span class="icon-[material-symbols--tab-close-outline]"></span> -->
        <span class="icon-[iconamoon--close] size-4"></span>
      </button>
    {/if}
  </div>

  <div class="flex flex-1 justify-center overflow-hidden">
    {#if isProjectInstance(instance)}
      <button
        style:opacity={swicherOpacity}
        class={[
          "flex cursor-default items-center gap-1 overflow-hidden rounded-sm pl-1 select-none",
          "border border-transparent hover:border-gray-300 active:bg-gray-200",
          opacityTransition && "transition-opacity duration-250 ease-linear",
        ]}
        onclick={popup}
      >
        <span class="truncate leading-6">
          {instance.project.name || placeholder.project.name}
        </span>
        <span class="icon-[mi--select] shrink-0"></span>
      </button>
    {/if}
  </div>
  <div class="size-5 flex-none">
    {#if isHomePanel && isProjectInstance(instance)}
      <button
        onclick={clonePanel}
        class="group flex size-full items-center justify-center"
        aria-label="to duplicate list"
      >
        <span
          class="icon-[mingcute--copy-2-line] group-hover:icon-[icon-park-solid--copy] size-4 group-active:bg-teal-400"
        ></span>
      </button>
    {/if}
  </div>
</div>
