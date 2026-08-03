import assert from "node:assert/strict";
import test from "node:test";

import {
  flattenCueText,
  parseSubtitleCues,
  parseSubtitleTimestampMs,
  stripSubtitleMarkup
} from "./subtitleCueParser.js";

test("parses SRT comma timestamps into milliseconds", () => {
  assert.equal(parseSubtitleTimestampMs("00:01:02,500"), 62500);
  assert.equal(parseSubtitleTimestampMs("01:00:00,000"), 3600000);
  assert.ok(Number.isNaN(parseSubtitleTimestampMs("not a timestamp")));
});

test("treats ASS centiseconds as the leading fraction digits", () => {
  // "0:00:12.34" is 12.34s in ASS, not 12.034s.
  assert.equal(parseSubtitleTimestampMs("0:00:12.34"), 12340);
});

test("parses an SRT document into ordered dialogue cues", () => {
  const srt = [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "Hello there.",
    "",
    "2",
    "00:00:04,500 --> 00:00:06,000",
    "General <i>Kenobi</i>.",
    ""
  ].join("\n");

  assert.deepEqual(parseSubtitleCues(srt), [
    { startMs: 1000, endMs: 3000, text: "Hello there." },
    { startMs: 4500, endMs: 6000, text: "General Kenobi." }
  ]);
});

test("parses WebVTT and preserves the cue's own line breaks", () => {
  const vtt = ["WEBVTT", "", "00:00:02.000 --> 00:00:05.000", "First line", "second line", ""].join(
    "\n"
  );

  // Breaks inside a cue are deliberate typesetting; flattening them runs two
  // speakers together on one line.
  assert.deepEqual(parseSubtitleCues(vtt), [
    { startMs: 2000, endMs: 5000, text: "First line\nsecond line" }
  ]);
});

test("keeps a two-speaker cue on two lines", () => {
  const srt = [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "- I love it.",
    "- When I found out.",
    ""
  ].join("\n");

  assert.equal(parseSubtitleCues(srt)[0].text, "- I love it.\n- When I found out.");
  assert.equal(flattenCueText(parseSubtitleCues(srt)[0].text), "- I love it. - When I found out.");
});

test("parses ASS dialogue using the Format header and keeps commas in text", () => {
  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:09.10,0:00:11.20,Default,,0,0,0,,{\\i1}Wait{\\i0}, stop!",
    "Dialogue: 0,0:00:12.00,0:00:13.00,Default,,0,0,0,,Line\\Nbreak"
  ].join("\n");

  assert.deepEqual(parseSubtitleCues(ass), [
    { startMs: 9100, endMs: 11200, text: "Wait, stop!" },
    { startMs: 12000, endMs: 13000, text: "Line\nbreak" }
  ]);
});

test("sorts cues by start time and drops malformed or empty blocks", () => {
  const srt = [
    "1",
    "00:00:09,000 --> 00:00:10,000",
    "Later",
    "",
    "2",
    "00:00:01,000 --> 00:00:02,000",
    "Earlier",
    "",
    "3",
    "00:00:20,000 --> 00:00:19,000",
    "Negative duration",
    "",
    "4",
    "no timing line here",
    "orphan text",
    "",
    "5",
    "00:00:30,000 --> 00:00:31,000",
    "<i></i>"
  ].join("\n");

  assert.deepEqual(parseSubtitleCues(srt), [
    { startMs: 1000, endMs: 2000, text: "Earlier" },
    { startMs: 9000, endMs: 10000, text: "Later" }
  ]);
});

test("strips markup and decodes entities without double-decoding ampersands", () => {
  assert.equal(stripSubtitleMarkup("{\\an8}<b>Bold</b> text"), "Bold text");
  assert.equal(stripSubtitleMarkup("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(stripSubtitleMarkup("&amp;lt; stays escaped"), "&lt; stays escaped");
  // \N is the ASS hard line break and must survive as a real break.
  assert.equal(stripSubtitleMarkup("a\\Nb"), "a\nb");
  assert.equal(flattenCueText("a\nb"), "a b");
});

test("returns an empty list for blank input", () => {
  assert.deepEqual(parseSubtitleCues(""), []);
  assert.deepEqual(parseSubtitleCues("   \n\n  "), []);
});
