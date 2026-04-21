import type { Input } from "$lib";
import type { CheckItem } from "$lib/client/model";
import { tick } from "svelte";

type BulletAccess = {
  getBulletInput: (c: { index?: number; id?: string }) => Input | undefined;
  addBulletAt: (index: number, ...texts: string[]) => void;
  deleteBulletAt: (index: number) => void;
  getBullet: (index: number) => CheckItem | undefined;
};

export function createBulletHandler({
  getBulletInput,
  addBulletAt,
  deleteBulletAt,
  getBullet,
}: BulletAccess) {
  async function handlePaste(bullet: CheckItem, index: number, ev: ClipboardEvent) {
    const textPasted = ev.clipboardData?.getData("text/plain");
    const linesToAdd = textPasted?.split(/\r\n|\r|\n/);
    if (linesToAdd == null || linesToAdd.length < 2) return;

    ev.preventDefault();
    const { text, id } = bullet;
    const input = getBulletInput({ id });
    if (input == null) return;

    const splitPoint = input.getCaretPosition() ?? text.length;
    const beforeCaret = text.substring(0, splitPoint);
    const afterCaret = text.substring(splitPoint);

    const [firstL, ...restLs] = linesToAdd;
    bullet.text = beforeCaret + firstL;

    const lastLText = restLs.at(-1)!; // since lines.length >= 2

    const textsToAdd = [...restLs.slice(0, -1), lastLText + afterCaret];
    addBulletAt(index + 1, ...textsToAdd);

    await tick();

    const inputToFocus = getBulletInput({
      index: index + textsToAdd.length,
    });
    inputToFocus?.setCaretPosition(lastLText.length);
  }

  async function handleKeyDown(bullet: CheckItem, index: number, total: number, ev: KeyboardEvent) {
    const { id, text } = bullet;
    const input = getBulletInput({ id });
    if (input == null) return;

    if (ev.key === "Enter") {
      ev.preventDefault();
      const splitPoint = input.getCaretPosition() ?? text.length;
      const beforeCaret = text.substring(0, splitPoint);
      const afterCaret = text.substring(splitPoint);

      bullet.text = beforeCaret;

      addBulletAt(index + 1, afterCaret);
      await tick();
      const inputToFocus = getBulletInput({ index: index + 1 });
      inputToFocus?.setCaretPosition("start");
      return;
    }

    const deleteKey = ev.key === "Backspace" || ev.key === "Delete";
    const comandKey = ev.metaKey || ev.ctrlKey;

    const selectionRange = input.getSelectionRange?.();
    const hasSelection = selectionRange != null && selectionRange.start !== selectionRange.end;

    if ((deleteKey && text === "") || (deleteKey && comandKey && total > 1)) {
      ev.preventDefault();
      const inputToFocus = getBulletInput({
        index: index + (index > 0 ? -1 : 1),
      });
      inputToFocus?.setCaretPosition("end");
      deleteBulletAt(index);
      return;
    }

    if (deleteKey && index > 0 && !hasSelection && input.getCaretPosition() === 0) {
      const preBullet = getBullet(index - 1);
      if (preBullet == null) return;
      ev.preventDefault();
      const { text: preText } = preBullet;
      preBullet.text = preText + text;
      deleteBulletAt(index);
      await tick();
      const inputToFocus = getBulletInput({ index: index - 1 });
      inputToFocus?.setCaretPosition(preText.length);
      return;
    }
  }

  function handleNavigate(
    index: number,
    total: number,
    direction: "up" | "down",
    preferredX: number | undefined,
    ev: KeyboardEvent,
  ) {
    const indexToFocus = index + (direction === "up" ? -1 : 1);
    if (indexToFocus < 0 || indexToFocus >= total) {
      return false; // not handled
    }
    ev.preventDefault();
    const inputToFocus = getBulletInput({ index: indexToFocus });
    inputToFocus?.moveCaretToX(preferredX, direction === "up" ? "bottom" : "top");
    return true;
  }

  return { handlePaste, handleKeyDown, handleNavigate };
}
