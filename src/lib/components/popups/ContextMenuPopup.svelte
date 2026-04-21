<script module>
  import { createContext } from "svelte";

  export type PopupArg = {
    x: number;
    y: number;
    count: number;
    itemLabel?: string;
    itemLabelPlural?: string;
    onDelete: () => void;
    onClose?: () => void;
    secondaryAction?: {
      label: string;
      onAction: () => void;
    };
  };

  type ContextMenuApi = {
    popup: (arg: PopupArg) => void;
    close: () => void;
    getCurrentArg: () => PopupArg | null;
  };

  const [useContextMenu, setContextMenu] = createContext<ContextMenuApi>();
  export { useContextMenu };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();

  let request: PopupArg | null = $state.raw(null);

  const close = () => {
    if (request?.onClose) request.onClose();
    request = null;
  };

  setContextMenu({
    popup: (arg) => {
      request = arg;
    },
    close,
    getCurrentArg: () => request,
  });

  const handleDelete = () => {
    request?.onDelete();
    close();
  };

  const handleSecondaryAction = () => {
    request?.secondaryAction?.onAction();
    close();
  };

  const getDeleteLabel = () => {
    const count = request?.count ?? 0;
    const itemLabel = request?.itemLabel ?? "item";
    const plural =
      request?.itemLabelPlural && request.itemLabelPlural.length > 0
        ? request.itemLabelPlural
        : `${itemLabel}s`;
    if (count === 1) return itemLabel;
    return `${count} ${plural}`;
  };
</script>

{@render children()}

{#if request}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40"
    onclick={close}
    onwheel={(ev) => ev.preventDefault()}
    ontouchmove={(ev) => ev.preventDefault()}
    oncontextmenu={(ev) => {
      ev.preventDefault();
      close();
    }}
  ></div>
  <div
    class="fixed z-50 w-40 rounded-md border border-gray-200 bg-white text-sm shadow-lg"
    style:top={`${request.y}px`}
    style:left={`${request.x}px`}
    onwheel={(ev) => ev.preventDefault()}
    ontouchmove={(ev) => ev.preventDefault()}
  >
    {#if request.secondaryAction}
      <button
        class="w-full border-b border-gray-200 px-3 py-2 text-left hover:bg-gray-100"
        onclick={handleSecondaryAction}
      >
        {request.secondaryAction.label}
      </button>
    {/if}
    <button class="w-full px-3 py-2 text-left hover:bg-gray-100" onclick={handleDelete}>
      Delete {getDeleteLabel()}
    </button>
  </div>
{/if}
