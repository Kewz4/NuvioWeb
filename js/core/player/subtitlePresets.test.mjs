import assert from "node:assert/strict";
import test from "node:test";

import {
  SUBTITLE_PRESETS,
  SUBTITLE_PRESET_CUSTOM,
  applySubtitlePreset,
  detectSubtitlePreset,
  nextSubtitlePreset
} from "./subtitlePresets.js";

test("the shipped default reads as Normal, not Custom", () => {
  // The store's default style must line up with a preset, or every viewer
  // starts on "Custom" having chosen nothing.
  assert.equal(
    detectSubtitlePreset({ fontSize: 120, bold: false, outlineEnabled: true }),
    "normal"
  );
});

test("each preset round-trips through apply and detect", () => {
  SUBTITLE_PRESETS.forEach((preset) => {
    const style = applySubtitlePreset(
      { fontSize: 120, bold: false, outlineEnabled: true },
      preset.id
    );
    assert.equal(detectSubtitlePreset(style), preset.id, preset.id);
  });
});

test("a hand-tuned size is reported as Custom rather than mislabelled", () => {
  assert.equal(
    detectSubtitlePreset({ fontSize: 140, bold: false, outlineEnabled: true }),
    SUBTITLE_PRESET_CUSTOM
  );
});

test("applying a preset leaves colour and position alone", () => {
  // Those are taste and overscan, not legibility; resetting them would undo a
  // deliberate choice.
  const style = {
    fontSize: 120,
    bold: false,
    outlineEnabled: true,
    textColor: "#FFEE00",
    outlineColor: "#112233",
    verticalOffset: 7
  };
  const next = applySubtitlePreset(style, "large");
  assert.equal(next.textColor, "#FFEE00");
  assert.equal(next.outlineColor, "#112233");
  assert.equal(next.verticalOffset, 7);
  assert.equal(next.fontSize, 165);
  assert.equal(next.bold, true);
});

test("an unknown preset id changes nothing", () => {
  const style = { fontSize: 120, bold: false, outlineEnabled: true };
  assert.deepEqual(applySubtitlePreset(style, "nonsense"), style);
});

test("cycling walks the presets and wraps", () => {
  assert.equal(nextSubtitlePreset("normal"), "large");
  assert.equal(nextSubtitlePreset("large"), "huge");
  assert.equal(nextSubtitlePreset("huge"), "normal");
  // Custom has no place in the cycle, so it enters at the start.
  assert.equal(nextSubtitlePreset(SUBTITLE_PRESET_CUSTOM), "normal");
});

test("presets get larger, and never smaller, down the list", () => {
  const sizes = SUBTITLE_PRESETS.map((preset) => preset.style.fontSize);
  assert.deepEqual(
    sizes,
    [...sizes].sort((a, b) => a - b)
  );
});
