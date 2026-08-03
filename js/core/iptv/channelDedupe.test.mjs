import assert from "node:assert/strict";
import test from "node:test";

import { channelIdentityKey, dedupeChannels } from "./channelDedupe.js";

function channel(overrides = {}) {
  return {
    id: overrides.id || `id-${Math.random()}`,
    name: "Azteca Uno (1080p)",
    country: "MX",
    tvgId: "AztecaUno.mx@SD",
    logo: "",
    qualityLabel: "FHD",
    streamUrl: "http://edge.test/azteca.m3u8",
    ...overrides
  };
}

test("the same stream URL is one channel however it is spelled", () => {
  const { channels, removed } = dedupeChannels([
    channel({ id: "a", streamUrl: "http://edge.test/x.m3u8" }),
    channel({ id: "b", streamUrl: "https://edge.test/x.m3u8/" })
  ]);
  assert.equal(channels.length, 1);
  assert.equal(removed, 1);
});

test("the same channel from two playlists collapses to the better copy", () => {
  const { channels } = dedupeChannels([
    channel({ id: "spa", streamUrl: "http://a.test/1", qualityLabel: "HD", tvgId: "", logo: "" }),
    channel({ id: "mx", streamUrl: "http://b.test/2", qualityLabel: "FHD", logo: "http://l/x.png" })
  ]);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].id, "mx", "the 1080p copy with artwork wins");
});

test("quality outranks metadata when picking the survivor", () => {
  const { channels } = dedupeChannels([
    channel({ id: "sd", streamUrl: "http://a/1", qualityLabel: "SD", logo: "http://l/x.png" }),
    channel({ id: "fhd", streamUrl: "http://b/2", qualityLabel: "FHD", tvgId: "", logo: "" })
  ]);
  assert.equal(channels[0].id, "fhd");
});

test("same name in different countries stays two channels", () => {
  // "Canal 5" is an unrelated broadcaster in México, Chile and Perú; merging
  // them would hide real channels rather than duplicates.
  const { channels, removed } = dedupeChannels([
    channel({
      id: "mx",
      name: "Canal 5",
      country: "MX",
      tvgId: "Canal5.mx",
      streamUrl: "http://a/1"
    }),
    channel({
      id: "cl",
      name: "Canal 5",
      country: "CL",
      tvgId: "Canal5.cl",
      streamUrl: "http://b/2"
    })
  ]);
  assert.equal(channels.length, 2);
  assert.equal(removed, 0);
});

test("the country comes from the tvg-id when the playlist omits it", () => {
  assert.equal(
    channelIdentityKey({ name: "Azteca Uno", country: "", tvgId: "AztecaUno.mx@SD" }),
    channelIdentityKey({ name: "Azteca Uno (1080p)", country: "MX", tvgId: "" })
  );
});

test("channels without a usable name are never merged on name alone", () => {
  const { channels } = dedupeChannels([
    channel({ id: "a", name: "", tvgId: "", country: "", streamUrl: "http://a/1" }),
    channel({ id: "b", name: "", tvgId: "", country: "", streamUrl: "http://b/2" })
  ]);
  assert.equal(channels.length, 2);
});

test("order is preserved so pinned playlists still lead", () => {
  const { channels } = dedupeChannels([
    channel({ id: "1", name: "Uno", tvgId: "Uno.mx", streamUrl: "http://a/1" }),
    channel({ id: "2", name: "Dos", tvgId: "Dos.mx", streamUrl: "http://a/2" }),
    channel({ id: "3", name: "Tres", tvgId: "Tres.mx", streamUrl: "http://a/3" })
  ]);
  assert.deepEqual(
    channels.map((entry) => entry.id),
    ["1", "2", "3"]
  );
});
