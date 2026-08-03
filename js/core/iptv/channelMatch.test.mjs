import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGuideKeyIndex,
  channelKeyVariants,
  channelMatchKeys,
  normalizeChannelKey,
  resolveGuideChannelId
} from "./channelMatch.js";

test("normalization removes accents, annotations and punctuation", () => {
  assert.equal(normalizeChannelKey("Canción Latina (1080p)"), "cancionlatina");
  assert.equal(normalizeChannelKey("ADN 40 [Not 24/7]"), "adn40");
  assert.equal(normalizeChannelKey("A+"), "aplus");
});

test("a filler-only name still yields a key", () => {
  // "Canal 5" must not collapse to "" just because "canal" is filler and "5"
  // is too short on its own.
  assert.deepEqual(channelKeyVariants("Canal 5"), ["canal5"]);
  assert.deepEqual(channelKeyVariants("Canal Azteca Uno"), ["canalaztecauno", "aztecauno"]);
});

test("channel keys strip the feed and country suffixes from a tvg-id", () => {
  const keys = channelMatchKeys({ tvgId: "ADN40.mx@SD", name: "ADN 40 (1080p)" });
  assert.ok(keys.includes("adn40"), keys.join(","));
});

test("matches a playlist channel to a differently-named guide entry", () => {
  const guide = new Map([
    ["adn40.mx", { names: ["adn40.mx"] }],
    ["Animal Planet.mx", { names: ["Animal Planet"] }]
  ]);
  const withProgrammes = new Set(["adn40.mx", "Animal Planet.mx"]);
  const index = buildGuideKeyIndex(guide, withProgrammes);

  assert.equal(
    resolveGuideChannelId({ tvgId: "ADN40.mx@SD", name: "ADN 40 (1080p)" }, index, withProgrammes),
    "adn40.mx"
  );
  assert.equal(
    resolveGuideChannelId({ tvgId: "", name: "Animal Planet (1080p)" }, index, withProgrammes),
    "Animal Planet.mx"
  );
});

test("an exact tvg-id wins over a normalized guess", () => {
  const guide = new Map([
    ["AztecaUno.mx", { names: ["Azteca Uno"] }],
    ["other.mx", { names: ["Azteca Uno"] }]
  ]);
  const withProgrammes = new Set(["AztecaUno.mx", "other.mx"]);
  const index = buildGuideKeyIndex(guide, withProgrammes);
  assert.equal(
    resolveGuideChannelId({ tvgId: "AztecaUno.mx", name: "Azteca Uno" }, index, withProgrammes),
    "AztecaUno.mx"
  );
});

test("guide entries with no programmes never shadow ones that have them", () => {
  const guide = new Map([
    ["empty.mx", { names: ["Telemundo"] }],
    ["real.mx", { names: ["Telemundo"] }]
  ]);
  const withProgrammes = new Set(["real.mx"]);
  const index = buildGuideKeyIndex(guide, withProgrammes);
  assert.equal(resolveGuideChannelId({ name: "Telemundo" }, index, withProgrammes), "real.mx");
});

test("an unmatched channel resolves to nothing rather than a wrong guide", () => {
  const index = buildGuideKeyIndex(new Map([["cnn.us", { names: ["CNN"] }]]), new Set(["cnn.us"]));
  assert.equal(resolveGuideChannelId({ name: "B15 Fresnillo" }, index, new Set(["cnn.us"])), "");
});
