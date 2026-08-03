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
      "Top 10 de Netflix · Películas",
      "Top 10 de Netflix · Series",
      "Studios",
      "Streaming"
    ]
  );
  assert.deepEqual(
    payload.sections.map((section) => section.tiles.length),
    [3, 2, 2, 2, 2, 5, 5]
  );
  assert.ok(payload.sections.every((section) => section.title_display_mode === "AlwaysOn"));
  assert.equal(
    payload.sections.reduce((sum, section) => sum + section.tiles.length, 0),
    21
  );
  const actionData = payload.sections.flatMap((section) =>
    section.tiles.map((tile) => tile.action_data)
  );
  assert.equal(new Set(actionData).size, actionData.length);
  assert.equal(JSON.parse(payload.sections[0].tiles[0].action_data).source, "continue-watching");
  assert.equal(JSON.parse(payload.sections[1].tiles[0].action_data).source, "xperience");
  assert.equal(JSON.parse(payload.sections[5].tiles[0].action_data).kind, "collection-folder");
  // Tizen 6.5 hides the row headers, so each tile states why it is there — but
  // briefly, because the card truncates and the media name must survive.
  assert.equal(payload.sections[0].tiles[0].title, "▶ Sigue viendo · Continue 0");
  // Short badge on the title so the media name survives; the reason spelled
  // out on the subtitle, where there is room for it.
  assert.equal(payload.sections[1].tiles[0].title, "★ Para ti · movie-because-movies-1");
  assert.equal(payload.sections[1].tiles[0].subtitle, "Porque viste · Película");
  assert.equal(payload.sections[3].tiles[0].subtitle, "Top 10 de Netflix · Película");
  // A top-ten row carries each tile's rank, which is the reason to look at it.
  assert.equal(payload.sections[3].tiles[0].title, "#1 Netflix · movie-netflix-top10-movies-1");
  assert.equal(payload.sections[3].tiles[1].title, "#2 Netflix · movie-netflix-top10-movies-2");
  // A studio name explains itself; prefixing it only costs characters.
  assert.equal(payload.sections[5].tiles[0].title, "Marvel");
  assert.equal(payload.sections[5].tiles[0].subtitle, "Studios");

  // Every visible title has to survive the card's truncation.
  payload.sections.forEach((section) =>
    section.tiles.forEach((tile) =>
      assert.ok(
        tile.title.length <= 46,
        `tile title too long to render: ${JSON.stringify(tile.title)}`
      )
    )
  );
});

test("continue watching says how much is left, not what percentage is done", () => {
  const payload = buildSmartHubPreviewPayload({
    continueWatching: [
      {
        contentId: "tt-a",
        contentType: "series",
        title: "Serie",
        season: 2,
        episode: 4,
        positionMs: 12 * 60000,
        durationMs: 45 * 60000,
        progressPercent: 27,
        background: "https://image.tmdb.org/t/p/w1280/a.jpg"
      },
      {
        // No duration saved: the percentage remains the only thing we can say.
        contentId: "tt-b",
        contentType: "movie",
        title: "Peli",
        progressPercent: 40,
        background: "https://image.tmdb.org/t/p/w1280/b.jpg"
      }
    ]
  });

  assert.equal(payload.sections[0].tiles[0].subtitle, "T2 E4 · faltan 33 min");
  assert.equal(payload.sections[0].tiles[1].subtitle, "40% visto");
  // Samsung draws its own play affordance on playable tiles.
  assert.equal(payload.sections[0].tiles[0].is_playable, true);
});

test("accepts only image formats supported by Samsung Smart Hub Preview", () => {
  assert.equal(isSupportedPreviewImageUrl("https://example.com/tile.jpg"), true);
  assert.equal(isSupportedPreviewImageUrl("https://example.com/tile.PNG?v=2"), true);
  assert.equal(
    isSupportedPreviewImageUrl("https://images.metahub.space/background/medium/tt0133093/img"),
    true
  );
  assert.equal(
    isSupportedPreviewImageUrl(
      "https://images.metahub.space/poster/small/tt0133093/img?language=es"
    ),
    true
  );
  assert.equal(
    isSupportedPreviewImageUrl("https://example.com/poster/medium/tt0133093/img"),
    false
  );
  assert.equal(
    isSupportedPreviewImageUrl(
      "https://images.metahub.space.evil.example/poster/medium/tt0133093/img"
    ),
    false
  );
  assert.equal(isSupportedPreviewImageUrl("https://example.com/tile.webp"), false);
  assert.equal(isSupportedPreviewImageUrl("file:///tile.jpg"), false);
  assert.equal(
    normalizePreviewImageUrl("https://image.tmdb.org/t/p/w1280/example.jpg"),
    "https://image.tmdb.org/t/p/w500/example.jpg"
  );
  assert.equal(
    normalizePreviewImageUrl("https://images.metahub.space/background/medium/tt0133093/img"),
    "https://images.metahub.space/background/small/tt0133093/img"
  );
});

test("uses Cinemeta artwork without leaking stream identity into preview actions", () => {
  const payload = buildSmartHubPreviewPayload({
    continueWatching: [
      {
        contentId: "tt0133093",
        contentType: "movie",
        title: "The Matrix",
        streamIdentity: "private-stream-identity",
        enrichedMeta: {
          background: "https://images.metahub.space/background/medium/tt0133093/img"
        }
      }
    ]
  });

  const tile = payload.sections[0].tiles[0];
  assert.equal(tile.image_url, "https://images.metahub.space/background/small/tt0133093/img");
  assert.equal(Object.hasOwn(JSON.parse(tile.action_data), "resumeStreamIdentity"), false);
});

test("makes repeated media deep links unique across catalog rows", () => {
  const repeatedItem = mediaItem("tt-same");
  const payload = buildSmartHubPreviewPayload({
    catalogSections: [
      { key: "row-a", title: "Fila A", type: "movie", limit: 1, items: [repeatedItem] },
      { key: "row-b", title: "Fila B", type: "movie", limit: 1, items: [repeatedItem] }
    ]
  });

  const firstAction = JSON.parse(payload.sections[0].tiles[0].action_data);
  const secondAction = JSON.parse(payload.sections[1].tiles[0].action_data);
  assert.equal(firstAction.itemId, secondAction.itemId);
  assert.notEqual(firstAction.previewInstance, secondAction.previewInstance);
  assert.notEqual(
    payload.sections[0].tiles[0].action_data,
    payload.sections[1].tiles[0].action_data
  );
});

test("backfills requested rows after skipping candidates without supported artwork", () => {
  const invalid = {
    contentId: "invalid",
    contentType: "movie",
    title: "No compatible image",
    background: "https://example.com/image.webp"
  };
  const payload = buildSmartHubPreviewPayload({
    continueWatching: [invalid, mediaItem("cw-valid-1"), mediaItem("cw-valid-2")],
    continueWatchingLimit: 2,
    catalogSections: [
      {
        title: "Top 10 de Netflix · Películas",
        type: "movie",
        limit: 2,
        items: [invalid, mediaItem("catalog-valid-1"), mediaItem("catalog-valid-2")]
      }
    ]
  });

  assert.deepEqual(
    payload.sections.map((section) => section.tiles.length),
    [2, 2]
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
