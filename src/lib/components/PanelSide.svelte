<script lang="ts" module>
  import { useCreateProject } from "$lib/client/mutate-remote";
  import { useSetOperationInPanel, useSetProjInPanel } from "$lib/client/mutate-local";

  const useMutator = () => ({
    createProject: useCreateProject(),
    setProjInPanel: useSetProjInPanel(),
    setOperationInPanel: useSetOperationInPanel(),
  });
  type Mutator = ReturnType<typeof useMutator>;
</script>

<script lang="ts">
  import type { ClassValue, HTMLAttributes } from "svelte/elements";
  import {
    isProjectInstance,
    newProjectInstance,
    newProjectItem,
    type Instance,
    type ProjectInstance,
    type ProjectItem,
  } from "$lib";
  import ProjectList from "$lib/components/project-list/ProjectList.svelte";
  import OperationList from "./operation-list/OperationList.svelte";
  import { getAppState } from "$lib/client/context";
  type Props = {
    instance: Instance;
    bottomBarHeight: number;
    topBarHeight: number;
    class?: ClassValue;
    newProjIdToReveal: string | null;
    mut?: Mutator;
  };

  let {
    instance,
    newProjIdToReveal = $bindable(),
    bottomBarHeight,
    topBarHeight,
    class: className,
    mut = useMutator(),
  }: Props = $props();

  let projsSelected: Record<string, boolean | undefined> = $state(
    isProjectInstance(instance) ? { [instance.project.id]: true } : {},
  );


  const appState = getAppState();
  let projects = $derived(appState.projects)


  const insertNew = async () => {
    let lastSelectedIndex = -1;
    for (const [i, proj] of projects.entries()) {
      if (projsSelected[proj.id]) lastSelectedIndex = i;
    }
    const insertIndex = lastSelectedIndex >= 0 ? lastSelectedIndex + 1 : 0;
    const { id } = await mut.createProject(insertIndex);
    projsSelected = { [id]: true };
    newProjIdToReveal = id;
  };
</script>

<div
  class={["flex size-full flex-col bg-teal-100", className]}
  style:padding-top="{topBarHeight}px"
>
  <OperationList
    class="w-full flex-none px-2 pt-5 pb-4 text-sm"
    operationShown={isProjectInstance(instance) ? null : instance}
    showOperation={(op) => {
      mut.setOperationInPanel(op);
      projsSelected = {};
    }}
  ></OperationList>

  <ProjectList
    class="flex min-h-0 flex-1 px-2"
    data={projects}
    bind:selected={projsSelected}
    projIdShown={isProjectInstance(instance) ? instance.project.id : null}
    showProject={(project) => {
      mut.setProjInPanel(project.id);
    }}
  ></ProjectList>
  <div
    class="flex w-full flex-none items-center border-t border-gray-200 px-2 text-gray-500"
    style:height="{bottomBarHeight}px"
  >
    <button
      class="flex h-7 flex-none items-center justify-center rounded-full border border-transparent px-2 text-sm hover:border-gray-300 active:bg-gray-300/20"
      onclick={insertNew}
    >
      + New List
    </button>
    <div class="flex-1"></div>
    <button
      class="flex h-7 flex-none items-center justify-center rounded-full border border-transparent px-2 hover:border-gray-300 active:bg-gray-300/20"
      aria-label="go to settings"
    >
      <span class="icon-[basil--settings-adjust-outline] size-5"></span>
    </button>
  </div>
</div>
