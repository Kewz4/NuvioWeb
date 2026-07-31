import test from "node:test";
import assert from "node:assert/strict";
import { SMART_HUB_PREVIEW_CONFIG } from "../js/platform/tizen/smartHubPreviewConfig.js";
import {
  buildSmartHubPreviewPayload,
  extractSmartHubPreviewAction,
  isSupportedPreviewImageUrl,
  normalizePreviewImageUrl
} from "../js/platform/tizen/smartHubPreviewData.js";

function mediaItem(id, type = "movie") {
  return {
    id,
    name: `${type}-${id}`,
    type,
    background: `https://image.tmdb.org/t/p/w1280/${id}.jpg`,
    poster: `https://image.tmdb.org/t/p/w500/${id}.jpg`
  };
}

test("builds the requested 21-tile Smart Hub layout in priority order", () => {
  const continueWatching = Array.from({ length: 3 }, (_, index) => ({
    contentId: `tt-cw-${index}`,
    contentType: index === 0 ? "series" : "movie",
    title: `Continue ${index}`,
    background: `https://image.tmdb.org/t/p/w1280/cw-${index}.jpg`,
    progressPercent: 25 + index,
    season: 1,
    episode: index + 1
  }));
  const catalogSections = SMART_HUB_PREVIEW_CONFIG.catalogSections.map((section) => ({
    ...section,
    items: [
      mediaItem(`${section.key}-1`, section.type),
      mediaItem(`${section.key}-2`, section.type)
    ]
  }));

  const payload = buildSmartHubPreviewPayload({
    continueWatching,
    catalogSections,
    folderSections: SMART_HUB_PREVIEW_CONFIG.folderSections,
    addon: {
      id: SMART_HUB_PREVIEW_CONFIG.addonId,
      name: "Xperience",
      baseUrl: "https://xperience-app.com/example"
    }
  });

  assert.deepEqual(
    payload.sections.map((section) => section.title),
    [
      "Continuar viendo",
      "Porque viste · Películas",
      "Porque viste · Series",
      "Top 100 hoy · Películas",
      "Top 100 hoy · Series",
      "Studios",
      "Streaming"
    ]
  );
  assert.deepEqual(
    payload.sections.map((section) => section.tiles.length),
    [3, 2, 2, 2, 2, 5, 5]
  );
  assert.equal(
    payload.sections.reduce((sum, section) => sum + section.tiles.length, 0),
    21
  );
  assert.equal(JSON.parse(payload.sections[0].tiles[0].action_data).source, "continue-watching");
  assert.equal(JSON.parse(payload.sections[1].tiles[0].action_data).source, "xperience");
  assert.equal(JSON.parse(payload.sections[5].tiles[0].action_data).kind, "collection-folder");
});

test("accepts only image formats supported by Samsung Smart Hub Preview", () => {
  assert.equal(isSupportedPreviewImageUrl("https://example.com/tile.jpg"), true);
  assert.equal(isSupportedPreviewImageUrl("https://example.com/tile.PNG?v=2"), true);
  assert.equal(isSupportedPreviewImageUrl("https://example.com/tile.webp"), false);
  assert.equal(isSupportedPreviewImageUrl("file:///tile.jpg"), false);
  assert.equal(
    normalizePreviewImageUrl("https://image.tmdb.org/t/p/w1280/example.jpg"),
    "https://image.tmdb.org/t/p/w500/example.jpg"
  );
});

test("extracts direct and Samsung-wrapped PAYLOAD actions", () => {
  const action = {
    nuvioPreview: 1,
    kind: "media",
    itemId: "tt123",
    itemType: "movie"
  };
  const direct = {
    appControl: {
      data: [{ key: "PAYLOAD", value: [JSON.stringify(action)] }]
    }
  };
  const wrapped = {
    appControl: {
      data: [
        {
          key: "PAYLOAD",
          value: [JSON.stringify({ values: JSON.stringify(action) })]
        }
      ]
    }
  };

  assert.deepEqual(extractSmartHubPreviewAction(direct), action);
  assert.deepEqual(extractSmartHubPreviewAction(wrapped), action);
});
