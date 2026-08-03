import assert from "node:assert/strict";
import test from "node:test";

import { clearIptvCaches, loadIptvSnapshot, loadSharedGuideData } from "./iptvRepository.js";
import { parseXmltv } from "../../core/iptv/epgIndex.js";
import { MAX_IPTV_PLAYLISTS, normalizeIptvSettings } from "../local/iptvSettingsStore.js";

const M3U = [
  "#EXTM3U",
  '#EXTINF:-1 tvg-id="cnn.us" group-title="News",CNN',
  "http://example.test/cnn.m3u8",
  '#EXTINF:-1 tvg-id="espn.us" group-title="Sports",ESPN',
  "http://example.test/espn.m3u8",
  '#EXTINF:-1 tvg-id="fox.us" group-title="Sports",FOX',
  "http://example.test/fox.m3u8"
].join("\n");

const XMLTV = `<tv>
  <programme start="20260801180000 +0000" stop="20260801190000 +0000" channel="cnn.us">
    <title>World News</title>
  </programme>
</tv>`;

// Fixtures pin defaultsSeededVersion so the shipped sources are not appended:
// these tests assert on an exact playlist set.
const SEEDED = 1;

function settingsFor(overrides = {}) {
  return normalizeIptvSettings({
    defaultsSeededVersion: SEEDED,
    playlists: [{ id: "p1", name: "Main", url: "http://example.test/list.m3u" }],
    ...overrides
  });
}

test("builds a grouped snapshot from an M3U playlist", async () => {
  clearIptvCaches();
  const snapshot = await loadIptvSnapshot(settingsFor(), {
    fetchText: async () => M3U,
    fetchJson: async () => [],
    nowMs: Date.UTC(2026, 7, 1, 18, 30)
  });

  assert.equal(snapshot.channels.length, 3);
  // Canonical order: news leads sports regardless of channel count.
  assert.deepEqual(
    snapshot.groups.map((group) => group.name),
    ["news", "sports"]
  );
  assert.deepEqual(snapshot.warnings, []);
  assert.equal(snapshot.guideOnDemand, false);
});

test("hides suppressed groups and surfaces favorites", async () => {
  clearIptvCaches();
  const snapshot = await loadIptvSnapshot(
    settingsFor({ hiddenGroups: ["Sports"], favoriteChannelIds: ["p1:cnn.us"] }),
    { fetchText: async () => M3U, fetchJson: async () => [] }
  );

  assert.deepEqual(
    snapshot.groups.map((group) => group.name),
    ["news"]
  );
  assert.equal(snapshot.favorites.length, 1);
  assert.equal(snapshot.favorites[0].name, "CNN");
});

test("attaches now/next from an XMLTV guide", async () => {
  clearIptvCaches();
  const snapshot = await loadIptvSnapshot(
    settingsFor({
      playlists: [
        {
          id: "p1",
          name: "Main",
          url: "http://example.test/list.m3u",
          epgUrl: "http://example.test/guide.xml"
        }
      ]
    }),
    {
      fetchText: async (url) => (url.endsWith(".xml") ? XMLTV : M3U),
      fetchJson: async () => [],
      nowMs: Date.UTC(2026, 7, 1, 18, 30)
    }
  );

  assert.equal(snapshot.nowNext["p1:cnn.us"].now.title, "World News");
});

test("reports a failing playlist as a warning without breaking the rest", async () => {
  clearIptvCaches();
  const snapshot = await loadIptvSnapshot(
    normalizeIptvSettings({
      defaultsSeededVersion: SEEDED,
      playlists: [
        { id: "good", name: "Good", url: "http://example.test/good.m3u" },
        { id: "bad", name: "Bad", url: "http://example.test/bad.m3u" }
      ]
    }),
    {
      fetchText: async (url) => {
        if (url.includes("bad")) {
          throw new Error("HTTP 403");
        }
        return M3U;
      },
      fetchJson: async () => []
    }
  );

  assert.equal(snapshot.channels.length, 3);
  assert.equal(snapshot.warnings.length, 1);
  assert.match(snapshot.warnings[0], /Bad: HTTP 403/);
});

test("a broken guide never prevents channels from listing", async () => {
  clearIptvCaches();
  const snapshot = await loadIptvSnapshot(
    settingsFor({
      playlists: [
        {
          id: "p1",
          name: "Main",
          url: "http://example.test/list.m3u",
          epgUrl: "http://example.test/guide.xml"
        }
      ]
    }),
    {
      fetchText: async (url) => {
        if (url.endsWith(".xml")) {
          throw new Error("guide offline");
        }
        return M3U;
      },
      fetchJson: async () => []
    }
  );

  assert.equal(snapshot.channels.length, 3);
  assert.deepEqual(snapshot.nowNext, {});
});

test("prefers the Xtream JSON API over downloading the M3U", async () => {
  clearIptvCaches();
  let textCalls = 0;
  const snapshot = await loadIptvSnapshot(
    normalizeIptvSettings({
      defaultsSeededVersion: SEEDED,
      playlists: [
        {
          id: "x1",
          name: "Panel",
          url: "http://panel.test/get.php?username=u&password=p&type=m3u_plus"
        }
      ]
    }),
    {
      fetchText: async () => {
        textCalls += 1;
        return M3U;
      },
      fetchJson: async (url) => {
        if (url.includes("get_live_categories")) {
          return [{ category_id: 1, category_name: "Deportes" }];
        }
        return [{ stream_id: 55, name: "ESPN", category_id: 1, epg_channel_id: "espn.us" }];
      }
    }
  );

  assert.equal(textCalls, 0, "M3U should not be downloaded when the API answers");
  assert.equal(snapshot.channels.length, 1);
  assert.equal(snapshot.channels[0].group, "Deportes");
  assert.equal(snapshot.channels[0].streamUrl, "http://panel.test/live/u/p/55.m3u8");
});

test("falls back to the M3U when the Xtream API returns nothing", async () => {
  clearIptvCaches();
  const snapshot = await loadIptvSnapshot(
    normalizeIptvSettings({
      defaultsSeededVersion: SEEDED,
      playlists: [
        { id: "x1", name: "Panel", url: "http://panel.test/get.php?username=u&password=p" }
      ]
    }),
    {
      fetchText: async () => M3U,
      fetchJson: async () => {
        throw new Error("panel down");
      }
    }
  );

  assert.equal(snapshot.channels.length, 3);
});

test("serves a second load from cache without refetching", async () => {
  clearIptvCaches();
  let fetches = 0;
  const deps = {
    fetchText: async () => {
      fetches += 1;
      return M3U;
    },
    fetchJson: async () => []
  };

  await loadIptvSnapshot(settingsFor(), deps);
  await loadIptvSnapshot(settingsFor(), deps);
  assert.equal(fetches, 1);

  await loadIptvSnapshot(settingsFor(), { ...deps, forceRefresh: true });
  assert.equal(fetches, 2);
});

test("skips disabled playlists entirely", async () => {
  clearIptvCaches();
  let fetches = 0;
  const snapshot = await loadIptvSnapshot(
    normalizeIptvSettings({
      defaultsSeededVersion: SEEDED,
      playlists: [{ id: "p1", name: "Off", url: "http://example.test/list.m3u", enabled: false }]
    }),
    {
      fetchText: async () => {
        fetches += 1;
        return M3U;
      },
      fetchJson: async () => []
    }
  );

  assert.equal(fetches, 0);
  assert.deepEqual(snapshot.channels, []);
});

test("normalizes settings: caps playlists and drops entries without a URL", () => {
  const overCap = Array.from({ length: MAX_IPTV_PLAYLISTS + 2 }, (_, index) => ({
    url: `http://a.test/${index}.m3u`
  }));
  const settings = normalizeIptvSettings({
    defaultsSeededVersion: SEEDED,
    playlists: [...overCap, { name: "no url" }],
    favoriteChannelIds: ["a", "a", "  ", "b"]
  });

  assert.equal(settings.playlists.length, MAX_IPTV_PLAYLISTS);
  assert.deepEqual(settings.favoriteChannelIds, ["a", "b"]);
  assert.equal(settings.playlists[0].name, "Playlist 1");
  assert.equal(settings.playlists[0].enabled, true);
});

test("a brand-new profile is seeded with the shipped Live TV sources", () => {
  const settings = normalizeIptvSettings({});
  assert.ok(settings.playlists.length > 0, "first run should not show an empty tab");
  assert.ok(settings.playlists.some((entry) => /iptv-org/.test(entry.url)));
  // Spanish leads, since that is what this household watches.
  assert.match(settings.playlists[0].name, /Espa/);
  assert.equal(settings.minQuality, "FHD");
});

test("an existing profile with an empty list still gets the shipped sources once", () => {
  // Profiles that opened Live TV before defaults existed have `playlists: []`
  // persisted. They must still be seeded, or the tab stays empty forever.
  const migrated = normalizeIptvSettings({ playlists: [] });
  assert.ok(migrated.playlists.length > 0, "legacy empty profile must be seeded");
  assert.equal(migrated.defaultsSeededVersion, 1);
});

test("once seeded, deleting every playlist is respected", () => {
  const cleared = normalizeIptvSettings({ playlists: [], defaultsSeededVersion: 1 });
  assert.deepEqual(cleared.playlists, [], "a seeded profile must not be re-seeded");
});

test("seeding preserves playlists the user added themselves", () => {
  const mine = { id: "mine", name: "Mi proveedor", url: "http://mine.test/list.m3u" };
  const seeded = normalizeIptvSettings({ playlists: [mine] });
  assert.equal(seeded.playlists[0].id, "mine", "user playlist keeps priority");
  assert.ok(seeded.playlists.length > 1, "shipped sources are appended alongside it");
});

/* Shared community guides ------------------------------------------------- */

const GUIDE_XML = `<tv>
  <channel id="cnn.us"><display-name>CNN</display-name></channel>
  <channel id="Fox Sports.mx"><display-name>Fox Sports</display-name></channel>
  <channel id="nobody.mx"><display-name>Nobody</display-name></channel>
  <programme start="20260801180000 +0000" stop="20260801190000 +0000" channel="cnn.us">
    <title>World News</title>
  </programme>
  <programme start="20260801190000 +0000" stop="20260801200000 +0000" channel="cnn.us">
    <title>Quest Means Business</title>
  </programme>
  <programme start="20260801180000 +0000" stop="20260801200000 +0000" channel="Fox Sports.mx">
    <title>Fútbol</title>
  </programme>
  <programme start="20260701180000 +0000" stop="20260701190000 +0000" channel="cnn.us">
    <title>Last month, out of window</title>
  </programme>
</tv>`;

const NOW = Date.UTC(2026, 7, 1, 18, 30);

test("a shared guide matches channels by name, not just by id", async () => {
  clearIptvCaches();
  // "FOX" in the playlist, "Fox Sports.mx" in the guide, and no shared id
  // scheme: name matching is the only thing that connects them.
  const channels = [
    { id: "p1:cnn", name: "CNN", tvgId: "cnn.us", streamUrl: "http://a/1" },
    { id: "p1:fox", name: "Fox Sports (1080p)", tvgId: "FoxSports.mx@SD", streamUrl: "http://a/2" },
    { id: "p1:local", name: "B15 Fresnillo", tvgId: "", streamUrl: "http://a/3" }
  ];

  const nowNext = await loadSharedGuideData(channels, {
    fetchText: async () => GUIDE_XML,
    nowMs: NOW,
    sources: [{ id: "g", url: "http://guide.test/all.xml" }]
  });

  assert.equal(nowNext["p1:cnn"].now.title, "World News");
  assert.equal(nowNext["p1:cnn"].next.title, "Quest Means Business");
  assert.equal(nowNext["p1:fox"].now.title, "Fútbol");
  assert.equal(
    nowNext["p1:local"],
    undefined,
    "an unmatched channel gets no guide, not a wrong one"
  );
});

test("shared guide fetches stop once every channel is matched", async () => {
  clearIptvCaches();
  let fetches = 0;
  await loadSharedGuideData(
    [{ id: "p1:cnn", name: "CNN", tvgId: "cnn.us", streamUrl: "http://a/1" }],
    {
      fetchText: async () => {
        fetches += 1;
        return GUIDE_XML;
      },
      nowMs: NOW,
      sources: [
        { id: "g1", url: "http://guide.test/1.xml" },
        { id: "g2", url: "http://guide.test/2.xml" },
        { id: "g3", url: "http://guide.test/3.xml" }
      ]
    }
  );
  assert.equal(fetches, 1, "later feeds are skipped once nothing is pending");
});

test("a guide host that is down never breaks the others", async () => {
  clearIptvCaches();
  const nowNext = await loadSharedGuideData(
    [{ id: "p1:cnn", name: "CNN", tvgId: "cnn.us", streamUrl: "http://a/1" }],
    {
      fetchText: async (url) => {
        if (url.includes("dead")) {
          throw new Error("ENOTFOUND");
        }
        return GUIDE_XML;
      },
      nowMs: NOW,
      sources: [
        { id: "g1", url: "http://dead.test/1.xml" },
        { id: "g2", url: "http://guide.test/2.xml" }
      ]
    }
  );
  assert.equal(nowNext["p1:cnn"].now.title, "World News");
});

test("shouldStop abandons the sweep between feeds", async () => {
  clearIptvCaches();
  let fetches = 0;
  const nowNext = await loadSharedGuideData(
    [{ id: "p1:none", name: "Nothing Matching Here", tvgId: "", streamUrl: "http://a/1" }],
    {
      fetchText: async () => {
        fetches += 1;
        return GUIDE_XML;
      },
      nowMs: NOW,
      shouldStop: () => fetches >= 1,
      sources: [
        { id: "g1", url: "http://guide.test/1.xml" },
        { id: "g2", url: "http://guide.test/2.xml" },
        { id: "g3", url: "http://guide.test/3.xml" }
      ]
    }
  );
  assert.equal(fetches, 1);
  assert.deepEqual(nowNext, {});
});

test("programmes outside the now/next window are discarded while parsing", async () => {
  clearIptvCaches();
  const index = parseXmltv(GUIDE_XML, {
    windowStartMs: NOW - 4 * 60 * 60 * 1000,
    windowEndMs: NOW + 12 * 60 * 60 * 1000
  });
  const titles = index.get("cnn.us").map((programme) => programme.title);
  assert.deepEqual(titles, ["World News", "Quest Means Business"]);
});

test("snapshot drops channels already known to be dead", async () => {
  clearIptvCaches();
  const snapshot = await loadIptvSnapshot(settingsFor(), {
    fetchText: async () => M3U,
    fetchJson: async () => [],
    excludeChannelIds: new Set(["p1:espn.us"])
  });
  assert.deepEqual(
    snapshot.channels.map((channel) => channel.name),
    ["CNN", "FOX"]
  );
});
