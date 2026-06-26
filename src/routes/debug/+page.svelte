<script lang="ts">
  import { Input, type TodoItem, newTodoItem } from "$lib";


  let value = $state("");
  let disabled = $state(true);

  let note = $state("");
  const placeholder = "Enter text here";
</script>



<div class="flex h-screen flex-col items-center gap-10 bg-purple-400 pt-50">
  <!-- <div>{}</div> -->
  <div class="w-80 bg-yellow-400">

      <Input
        class="bg-red-500 text-base wrap-break-word mt-8"
        bind:value={() => note, (v) => (v !== note ? (note = v) : null)}
        updateOnBlur
        placeholder="Note..."
      ></Input>

  </div>

  <button
    onclick={() => {
      disabled = !disabled;
    }}>toggle the `disabled` of tthe last two inputs</button
  >

  <Input bind:value {placeholder} updateOnBlur class="min-h-6 w-80 bg-amber-400 wrap-break-word"
  ></Input>

  <Input
    bind:value
    {placeholder}
    {disabled}
    updateOnBlur
    onblur={() => console.log("blurred")}
    class="h-6 w-80 truncate bg-amber-400"
  ></Input>
  <Input bind:value {placeholder} {disabled} updateOnBlur class="h-6 w-80 truncate bg-amber-400"
  ></Input>
</div>
