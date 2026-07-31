import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const foregroundSource = await readFile(
  new URL("../js/platform/tizen/smartHubPreview.js", import.meta.url),
  "utf8"
);
const serviceSource = await readFile(
  new URL("../services/tizen/smart-hub-preview-service.js", import.meta.url),
  "utf8"
);
const packageSource = await readFile(
  new URL("../scripts/package-tizen.mjs", import.meta.url),
  "utf8"
);

test("uses a shared private snapshot instead of embedding preview JSON in AppControl", () => {
  assert.match(foregroundSource, /smart-hub-preview\.pending\.json/);
  assert.match(serviceSource, /smart-hub-preview\.pending\.json/);
  assert.match(foregroundSource, /ApplicationControlData\("caller", \["ForegroundApp"\]\)/);
  assert.doesNotMatch(foregroundSource, /ApplicationControlData\("previewData"/);
  assert.doesNotMatch(serviceSource, /findIncomingPreviewData|key \|\| ""\) !== "previewData"/);
});

test("limits the false capability override to explicit emulator builds", () => {
  assert.match(foregroundSource, /__NUVIO_TIZEN_PREVIEW_ALLOW_FALSE_CAPABILITY__/);
  assert.match(foregroundSource, /Using the emulator capability override/);
  assert.match(foregroundSource, /Web service capability is unavailable/);
});

test("packages Samsung personal-preview metadata and a last-known-good fallback", () => {
  assert.match(packageSource, /metadata\/devel\.api\.version" value="5\.0"/);
  assert.match(packageSource, /metadata\/use\.preview" value="bg_service"/);
  assert.match(packageSource, /metadata\/prelaunch\.support" value="true"/);
  assert.match(serviceSource, /smart-hub-preview\.last-good\.json/);
  assert.match(serviceSource, /FALLBACK_PREVIEW_DATA/);
});
