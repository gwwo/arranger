<script lang="ts">
  import type { ClassValue } from "svelte/elements";
  type Props = {
    value: number;
    size?: number;
    stroke?: number;
    trackClass?: ClassValue;
    progressClass?: ClassValue;
  };

  let {
    value,
    size = 15,
    stroke = 3,
    trackClass = "text-gray-200",
    progressClass = "text-teal-500",
  }: Props = $props();

  const clamped = $derived(Math.max(0, Math.min(100, Math.round(value))));
  const radius = $derived((size - stroke) / 2);
  const circumference = $derived(2 * Math.PI * radius);
  const offset = $derived(circumference * (1 - clamped / 100));
</script>

<svg
  class="block"
  width={size}
  height={size}
  viewBox={`0 0 ${size} ${size}`}
  role="img"
  aria-label={`progress ${clamped}%`}
>
  <circle
    class={trackClass}
    cx={size / 2}
    cy={size / 2}
    r={radius}
    fill="none"
    stroke="currentColor"
    stroke-width={stroke}
  />
  <circle
    class={[progressClass, "progress-ring"]}
    cx={size / 2}
    cy={size / 2}
    r={radius}
    fill="none"
    stroke="currentColor"
    stroke-width={stroke}
    stroke-linecap="round"
    stroke-dasharray={circumference}
    stroke-dashoffset={offset}
    transform={`rotate(-90 ${size / 2} ${size / 2})`}
    style={`--dasharray:${circumference};--dashoffset:${offset};`}
  />
</svg>

<style>
  .progress-ring {
    stroke-dasharray: var(--dasharray);
    stroke-dashoffset: var(--dashoffset);
    animation: progress-in 500ms ease;
    transition: stroke-dashoffset 500ms ease;
  }

  @keyframes progress-in {
    from {
      stroke-dashoffset: var(--dasharray);
    }
  }
</style>
