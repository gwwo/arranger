<script lang="ts">
  import {
    isProjectInstance,
    type Instance,
    type PanelLayout,
    type PanelItem,
    type ProjectInstance,
    type ProjectItem,
  } from "$lib";
  import NavBar from "$lib/components/NavBar.svelte";
  import OperationPage from "$lib/components/operation-list/OperationPage.svelte";
  import PanelMain from "$lib/components/PanelMain.svelte";
  import PanelSide from "$lib/components/PanelSide.svelte";
  import ResizePanel from "$lib/components/ResizePanel.svelte";
  import { setPanelContext } from "$lib/client/context";

  type Props = {
    panel: PanelItem;
    isHomePanel: boolean;
  };

  let { panel, isHomePanel }: Props = $props();

  let newProjIdToReveal: string | null = $state(null);

  let instance = $derived(panel.instance);

  setPanelContext({ panelId: panel.id });
</script>

<ResizePanel layout={panel.layout}>
  {#snippet side(topBarHeight, bottomBarHeight)}
    <PanelSide bind:newProjIdToReveal {instance} {topBarHeight} {bottomBarHeight} />
  {/snippet}
  {#snippet main(topBarHeight, bottomBarHeight)}
    {#key instance}
      {#if isProjectInstance(instance)}
        <PanelMain bind:newProjIdToReveal {instance} {topBarHeight} {bottomBarHeight} />
      {:else}
        <OperationPage {instance}></OperationPage>
      {/if}
    {/key}
  {/snippet}
  {#snippet top(resizingSide, sideReveal)}
    <NavBar
      {isHomePanel}
      {instance}
      swicherOpacity={0.01 * Math.round(100 * (1 - sideReveal))}
      opacityTransition={!resizingSide}
      disable={panel.layout.sideShow}
    ></NavBar>
  {/snippet}
</ResizePanel>
