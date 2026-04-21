<script lang="ts">
  import "../app.css";
  let { children } = $props();
</script>

<svelte:head>
  <title>Arranger</title>
  <link rel="icon" href="/favicon.png" />
</svelte:head>

{@render children()}
