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

test("sends personalized data through AppControl with a shared snapshot fallback", () => {
  assert.match(foregroundSource, /smart-hub-preview\.pending\.json/);
  assert.match(serviceSource, /smart-hub-preview\.pending\.json/);
  assert.match(foregroundSource, /ApplicationControlData\("caller", \["ForegroundApp"\]\)/);
  assert.match(foregroundSource, /PREVIEW_APP_CONTROL_DATA_KEY/);
  assert.match(foregroundSource, /chunkPreviewData/);
  assert.match(serviceSource, /findIncomingPreviewData/);
  assert.match(serviceSource, /getRequestedAppControl/);
});

test("allows the known AU8000 capability false negative and explicit emulator builds", () => {
  assert.match(foregroundSource, /__NUVIO_TIZEN_PREVIEW_ALLOW_FALSE_CAPABILITY__/);
  assert.match(foregroundSource, /getRealModel/);
  assert.match(foregroundSource, /AU8000/);
  assert.match(foregroundSource, /Using the supported-device capability override/);
  assert.match(foregroundSource, /Web service capability is unavailable/);
});

test("packages Samsung personal-preview metadata without publishing fake fallback tiles", () => {
  assert.match(packageSource, /metadata\/devel\.api\.version" value="5\.0"/);
  assert.match(packageSource, /metadata\/use\.preview" value="bg_service"/);
  assert.match(packageSource, /metadata\/prelaunch\.support" value="true"/);
  assert.match(packageSource, /privilege\/productinfo/);
  assert.match(serviceSource, /smart-hub-preview\.last-good\.json/);
  assert.match(serviceSource, /leaving the existing preview unchanged/);
  assert.doesNotMatch(serviceSource, /FALLBACK_PREVIEW_DATA/);
});
