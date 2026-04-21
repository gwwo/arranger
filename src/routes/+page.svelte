<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import {
    ContextMenuPopup,
    PickerPopup,
    SwitcherPopup,
    type ProjectItem,
    type PanelItem,
  } from "$lib";
  import CheckListInsert from "$lib/components/check-list/CheckListInsert.svelte";
  import TodoListInsert from "$lib/components/todo-panel/TodoListInsert.svelte";
  import { onMount, tick, untrack } from "svelte";

  import ProjectListInsert from "$lib/components/project-list/ProjectListInsert.svelte";
  import PanelGroup from "$lib/components/PanelGroup.svelte";
  import Panel from "./Panel.svelte";
  import SideSliderDemo from "./side/SideSliderDemo.svelte";
  import { mockPanels, mockProjects } from "$lib/client/mock";
  import { setAppStateContext } from "$lib/client/context";

  const projects: ProjectItem[] = $state(mockProjects);
  const appState = $state({
    projects,
    panels: mockPanels(untrack(() => projects)),
  });
  setAppStateContext(appState);
  
  onMount(() => {
    // this to suppress Safari's `scroll to navigate back` behavoir
    const hijack = (ev: WheelEvent) => {};
    document.addEventListener("wheel", hijack);
    return () => document.removeEventListener("wheel", hijack);
  });
</script>

<!-- <SideSliderDemo ></SideSliderDemo> -->

<ContextMenuPopup>
  <SwitcherPopup>
    <PickerPopup>
      <ProjectListInsert>
        <TodoListInsert>
          <CheckListInsert>
            <PanelGroup>
              {#snippet each(panel, index)}
                <Panel {panel} isHomePanel={index === 0} />
              {/snippet}
            </PanelGroup>
          </CheckListInsert>
        </TodoListInsert>
      </ProjectListInsert>
    </PickerPopup>
  </SwitcherPopup>
</ContextMenuPopup>

<!-- <div class="w-full min-h-screen"></div> -->

<style>
  :global(.dragging-to-insert *) {
    cursor: default !important;
  }
</style>
