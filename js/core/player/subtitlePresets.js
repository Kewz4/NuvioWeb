// Named subtitle appearance presets.
//
// The individual controls — size, bold, outline, colour, vertical offset — are
// each correct and collectively too many. Someone who simply cannot read the
// subtitles has to find five separate settings and understand what each does,
// when what they actually want to say is "bigger".
//
// A preset says that in one step. The individual controls stay exactly as they
// were for anyone who wants them; choosing a preset just sets several at once,
// and changing any of them afterwards moves the selection to "Custom" rather
// than silently disagreeing with the label.

export const SUBTITLE_PRESET_CUSTOM = "custom";

export const SUBTITLE_PRESETS = Object.freeze([
  Object.freeze({
    id: "normal",
    labelKey: "subtitle_preset_normal",
    fallback: "Normal",
    style: { fontSize: 120, bold: false, outlineEnabled: true }
  }),
  Object.freeze({
    id: "large",
    labelKey: "subtitle_preset_large",
    fallback: "Large",
    // Bold arrives with size: at this scale the outline alone stops carrying
    // the letterforms against a bright scene.
    style: { fontSize: 165, bold: true, outlineEnabled: true }
  }),
  Object.freeze({
    id: "huge",
    labelKey: "subtitle_preset_huge",
    fallback: "Extra large",
    style: { fontSize: 215, bold: true, outlineEnabled: true }
  })
]);

/** The preset matching a style, or "custom" when it matches none. */
export function detectSubtitlePreset(style = {}) {
  const fontSize = Number(style?.fontSize);
  const bold = Boolean(style?.bold);
  const outlineEnabled = style?.outlineEnabled !== false;
  const match = SUBTITLE_PRESETS.find(
    (preset) =>
      preset.style.fontSize === fontSize &&
      preset.style.bold === bold &&
      preset.style.outlineEnabled === outlineEnabled
  );
  return match ? match.id : SUBTITLE_PRESET_CUSTOM;
}

/**
 * The style a preset produces, merged onto the current one.
 *
 * Colour and vertical offset are deliberately untouched: they are a matter of
 * taste and of where the TV's overscan falls, not of legibility, and silently
 * resetting them would undo a deliberate choice.
 */
export function applySubtitlePreset(style = {}, presetId = "") {
  const preset = SUBTITLE_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) {
    return { ...style };
  }
  return { ...style, ...preset.style };
}

/** The preset after this one, wrapping. Custom enters the list at the start. */
export function nextSubtitlePreset(presetId = "") {
  const index = SUBTITLE_PRESETS.findIndex((entry) => entry.id === presetId);
  if (index < 0) {
    return SUBTITLE_PRESETS[0].id;
  }
  return SUBTITLE_PRESETS[(index + 1) % SUBTITLE_PRESETS.length].id;
}
