import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SMART_HUB_CARD_BADGES,
  buildCardArtworkUrl,
  ingestCardArtwork
} from "./smartHubCardArtwork.js";

test("no artwork means no composited URL to offer", () => {
  assert.equal(buildCardArtworkUrl({}), "");
  assert.equal(buildCardArtworkUrl({ artworkUuid: "  " }), "");
});

test("the URL is sized for the tile and ends in a real extension", () => {
  const url = buildCardArtworkUrl({ artworkUuid: "abc" });
  assert.ok(url.includes(`/-/preview/${CARD_WIDTH}x${CARD_HEIGHT}/`));
  // Samsung's preview only accepts image URLs with a recognised extension.
  assert.ok(url.endsWith("card.jpg"));
});

test("a badge is layered over the scrim, in that order", () => {
  const url = buildCardArtworkUrl({
    artworkUuid: "abc",
    badge: SMART_HUB_CARD_BADGES.paraTi
  });
  const scrimAt = url.indexOf("c3ed7d64");
  const badgeAt = url.indexOf(SMART_HUB_CARD_BADGES.paraTi.uuid);
  assert.ok(scrimAt > 0 && badgeAt > scrimAt, "the scrim must sit under the badge");
});

test("a resume bar is drawn only when there is progress to show", () => {
  const withoutProgress = buildCardArtworkUrl({ artworkUuid: "abc" });
  assert.equal(withoutProgress.includes("81edc0a7"), false);

  const withProgress = buildCardArtworkUrl({ artworkUuid: "abc", progressPercent: 50 });
  assert.ok(withProgress.includes("b5a54b6d"), "track");
  assert.ok(withProgress.includes("81edc0a7"), "fill");
  // 50% of the 92%-wide track.
  assert.ok(withProgress.includes("/46px4p/"), withProgress);
});

test("progress is clamped so the bar cannot overrun or vanish", () => {
  assert.ok(buildCardArtworkUrl({ artworkUuid: "a", progressPercent: 400 }).includes("/92px4p/"));
  // A barely-started title still shows a sliver rather than nothing.
  assert.ok(buildCardArtworkUrl({ artworkUuid: "a", progressPercent: 0.4 }).includes("/1px4p/"));
  assert.equal(
    buildCardArtworkUrl({ artworkUuid: "a", progressPercent: 0 }).includes("81edc0a7"),
    false
  );
  assert.equal(
    buildCardArtworkUrl({ artworkUuid: "a", progressPercent: Number.NaN }).includes("81edc0a7"),
    false
  );
});

test("ingest returns the uuid once the CDN reports success", async () => {
  const calls = [];
  const uuid = await ingestCardArtwork("https://art.test/a.jpg", {
    publicKey: "pub",
    pollIntervalMs: 0,
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        json: async () =>
          url.includes("/status/")
            ? { status: "success", uuid: "ready-uuid" }
            : { type: "token", token: "tok" }
      };
    }
  });
  assert.equal(uuid, "ready-uuid");
  assert.ok(calls[0].includes("pub_key=pub"));
});

test("an already-ingested source short-circuits the polling", async () => {
  let calls = 0;
  const uuid = await ingestCardArtwork("https://art.test/a.jpg", {
    publicKey: "pub",
    pollIntervalMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return { json: async () => ({ uuid: "known-uuid" }) };
    }
  });
  assert.equal(uuid, "known-uuid");
  assert.equal(calls, 1);
});

test("an ingest failure yields nothing rather than throwing", async () => {
  // The card must fall back to plain artwork, never break the whole preview.
  assert.equal(
    await ingestCardArtwork("https://art.test/a.jpg", {
      publicKey: "pub",
      pollIntervalMs: 0,
      fetchImpl: async () => {
        throw new Error("offline");
      }
    }),
    ""
  );
  assert.equal(
    await ingestCardArtwork("https://art.test/a.jpg", {
      publicKey: "pub",
      pollIntervalMs: 0,
      fetchImpl: async (url) => ({
        json: async () =>
          url.includes("/status/") ? { status: "error", error: "404" } : { token: "tok" }
      })
    }),
    ""
  );
});

test("without a public key nothing is ingested", async () => {
  assert.equal(await ingestCardArtwork("https://art.test/a.jpg", { publicKey: "" }), "");
});
