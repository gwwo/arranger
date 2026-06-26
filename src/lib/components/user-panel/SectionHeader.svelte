<script lang="ts">
  // Section heading inside the panel — mirrors GroupingItem from TodoList
  // (teal-600 semibold label at 32px height).
  type Props = { label: string };
  let { label }: Props = $props();
</script>

<div
  class="mx-2 flex h-8 items-center px-3 font-semibold text-teal-600 pointer-events-none"
>
  {label}
</div>
