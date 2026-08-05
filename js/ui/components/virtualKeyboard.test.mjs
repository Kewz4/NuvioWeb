import assert from "node:assert/strict";
import test from "node:test";

import { createVirtualKeyboard } from "./virtualKeyboard.js";

/** A container stub: the keyboard only ever assigns innerHTML and adds a listener. */
function stubContainer() {
  return { innerHTML: "", addEventListener() {}, querySelector: () => null };
}

function makeKeyboard(overrides = {}) {
  const events = { change: [], submit: [], cancel: 0 };
  const keyboard = createVirtualKeyboard({
    container: stubContainer(),
    onChange: (value) => events.change.push(value),
    onSubmit: (value) => events.submit.push(value),
    onCancel: () => (events.cancel += 1),
    ...overrides
  });
  return { keyboard, events };
}

const press = (keyboard, key, keyCode = 0, extra = {}) =>
  keyboard.handleKeyDown({ key, keyCode, ...extra }, { isBack: false });

test("a physical keyboard types straight into the field", () => {
  const { keyboard } = makeKeyboard();
  assert.equal(press(keyboard, "a"), true);
  assert.equal(press(keyboard, "v"), true);
  assert.equal(press(keyboard, "e"), true);
  assert.equal(keyboard.getValue(), "ave");
});

test("accented and non-ASCII characters type too", () => {
  const { keyboard } = makeKeyboard();
  press(keyboard, "ñ");
  press(keyboard, "Á");
  assert.equal(keyboard.getValue(), "ñÁ");
});

test("Backspace deletes and Delete clears", () => {
  const { keyboard } = makeKeyboard({ value: "abc" });
  press(keyboard, "Backspace", 8);
  assert.equal(keyboard.getValue(), "ab");
  press(keyboard, "Delete", 46);
  assert.equal(keyboard.getValue(), "");
});

test("Escape cancels", () => {
  const { keyboard, events } = makeKeyboard();
  press(keyboard, "Escape", 27);
  assert.equal(events.cancel, 1);
});

test("a shortcut is not text", () => {
  // Ctrl+A must not insert an "a"; it is not meant for the field.
  const { keyboard } = makeKeyboard();
  assert.equal(press(keyboard, "a", 65, { ctrlKey: true }), false);
  assert.equal(keyboard.getValue(), "");
});

test("navigation keys still drive the grid rather than typing", () => {
  const { keyboard } = makeKeyboard();
  assert.equal(press(keyboard, "ArrowRight", 39), true);
  assert.equal(press(keyboard, "ArrowDown", 40), true);
  assert.equal(keyboard.getValue(), "", "arrows must never become text");
});

test("Enter on a key inserts it, so remote and keyboard mix mid-word", () => {
  const { keyboard } = makeKeyboard();
  press(keyboard, "h");
  // Grid starts on the number row, first column.
  press(keyboard, "Enter", 13);
  assert.equal(keyboard.getValue(), "h1");
});

test("an unhandled key is reported as unhandled so the screen can act on it", () => {
  const { keyboard } = makeKeyboard();
  assert.equal(press(keyboard, "F5", 116), false);
});
