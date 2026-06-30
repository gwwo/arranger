<script lang="ts">
  import "../app.css";
  let { children } = $props();

  // The loading banner / panel-stage flow runs only on "/": its +page.svelte
  // onMount calls markInteractive() to clear it. Every other route is marked
  // interactive up front by app.html's head script (keyed on pathname), so no
  // route-level fallback is needed here to un-stick the banner.
</script>

<svelte:head>
  <title>Arranger</title>
  <link rel="icon" href="/favicon.png" />
</svelte:head>

{@render children()}
