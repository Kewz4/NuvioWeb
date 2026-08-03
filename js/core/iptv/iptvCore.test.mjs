import assert from "node:assert/strict";
import test from "node:test";

import {
  extinfTitle,
  groupChannels,
  inferQualityLabel,
  isDividerChannelName,
  filterChannelsByMinQuality,
  orderGroupNames,
  parseM3u
} from "./m3uParser.js";
import {
  buildNowNextMap,
  nowNextFor,
  parseXmltv,
  parseXmltvTimestamp,
  programmeProgress
} from "./epgIndex.js";
import {
  buildXtreamPlayerApiUrl,
  buildXtreamStreamUrl,
  fetchXtreamLiveChannels,
  fetchXtreamNowNext,
  isXtreamPlaylistUrl,
  parseXtreamInfo,
  xtreamInfoFromCredentials
} from "./xtreamClient.js";

const PLAYLIST = [
  "#EXTM3U",
  '#EXTINF:-1 tvg-id="cnn.us" tvg-name="CNN HD" tvg-logo="http://logo/cnn.png" group-title="News",CNN HD',
  "http://example.test/live/cnn.m3u8",
  '#EXTINF:-1 tvg-id="espn.us" group-title="Sports" tvg-chno="205",ESPN 4K',
  "http://example.test/live/espn.m3u8",
  '#EXTINF:-1 group-title="Sports",========',
  "http://example.test/live/divider.m3u8",
  '#EXTINF:-1 tvg-id="cnn.us" group-title="News",CNN HD duplicate',
  "http://example.test/live/cnn.m3u8"
].join("\n");

test("parses EXTINF attributes into channels", () => {
  const channels = parseM3u(PLAYLIST, "pl1");
  assert.equal(channels.length, 2);

  assert.deepEqual(
    { ...channels[0] },
    {
      id: "pl1:cnn.us",
      playlistId: "pl1",
      name: "CNN HD",
      group: "News",
      logo: "http://logo/cnn.png",
      tvgId: "cnn.us",
      number: "",
      language: "",
      country: "",
      qualityLabel: "HD",
      streamUrl: "http://example.test/live/cnn.m3u8"
    }
  );
  assert.equal(channels[1].number, "205");
  assert.equal(channels[1].qualityLabel, "4K");
});

test("drops cosmetic divider rows and duplicate ids", () => {
  assert.equal(isDividerChannelName("==== SPORTS ===="), false);
  assert.equal(isDividerChannelName("======"), true);
  assert.equal(isDividerChannelName("  ---  "), true);
  assert.equal(isDividerChannelName("CNN"), false);

  const names = parseM3u(PLAYLIST, "pl1").map((channel) => channel.name);
  assert.deepEqual(names, ["CNN HD", "ESPN 4K"]);
});

test("infers a quality label from the channel or group name", () => {
  assert.equal(inferQualityLabel("Movie Channel UHD", ""), "4K");
  assert.equal(inferQualityLabel("Channel", "1080p Feeds"), "FHD");
  assert.equal(inferQualityLabel("Plain Channel", "General"), "");
});

test("handles an empty or headerless playlist without throwing", () => {
  assert.deepEqual(parseM3u("", "pl"), []);
  assert.deepEqual(parseM3u("not a playlist at all", "pl"), []);
});

test("groups channels into canonical categories and hides suppressed ones", () => {
  const channels = parseM3u(PLAYLIST, "pl1");
  const groups = groupChannels(channels);
  assert.deepEqual([...groups.keys()].sort(), ["news", "sports"]);

  // Hiding accepts the canonical id and the raw group-title alike, since a
  // profile may have hidden a group before the taxonomy existed.
  assert.deepEqual([...groupChannels(channels, { hiddenGroups: ["sports"] }).keys()], ["news"]);
  assert.deepEqual([...groupChannels(channels, { hiddenGroups: ["Sports"] }).keys()], ["news"]);
});

test("compound group tags collapse to one category, most specific winning", () => {
  const playlist = [
    "#EXTM3U",
    '#EXTINF:-1 group-title="Animation;Kids",Kid One',
    "http://a.test/1",
    '#EXTINF:-1 group-title="Kids;Public",Kid Two',
    "http://a.test/2",
    '#EXTINF:-1 group-title="Classic;Comedy;Public;Series",A Series',
    "http://a.test/3",
    '#EXTINF:-1 group-title="Movies;News",A News Channel',
    "http://a.test/4",
    '#EXTINF:-1 group-title="General;Public",Just General',
    "http://a.test/5",
    '#EXTINF:-1 group-title="Undefined",Untagged',
    "http://a.test/6"
  ].join("\n");
  const groups = groupChannels(parseM3u(playlist, "pl"));

  assert.deepEqual(
    groups.get("kids").map((channel) => channel.name),
    ["Kid One", "Kid Two"],
    "Animation;Kids and Kids;Public are the same category"
  );
  assert.deepEqual(
    groups.get("series").map((channel) => channel.name),
    ["A Series"],
    "Series outranks the generic tags bundled with it"
  );
  assert.deepEqual(
    groups.get("news").map((channel) => channel.name),
    ["A News Channel"],
    "news outranks movies so the news stays findable"
  );
  assert.deepEqual(
    groups.get("general").map((channel) => channel.name),
    ["Just General", "Untagged"]
  );
});

test("orders categories by the canonical list, not by size", () => {
  const playlist = [
    "#EXTM3U",
    ...Array.from({ length: 5 }, (_, i) => [
      `#EXTINF:-1 group-title="General",G${i}`,
      `http://a.test/g${i}`
    ]).flat(),
    '#EXTINF:-1 group-title="News",N0',
    "http://a.test/n0"
  ].join("\n");
  const groups = groupChannels(parseM3u(playlist, "pl"));
  // A thousand miscellaneous channels must not outrank the news.
  assert.deepEqual(orderGroupNames(groups, []), ["news", "general"]);
});

test("pinned groups lead, and non-canonical provider categories keep a place", () => {
  // An Xtream panel supplies its own category names; they are not canonical but
  // must still be listed, largest first.
  const groups = new Map([
    ["Small", [1]],
    ["Big", [1, 2, 3]],
    ["Medium", [1, 2]]
  ]);
  assert.deepEqual(orderGroupNames(groups, []), ["Big", "Medium", "Small"]);
  assert.deepEqual(orderGroupNames(groups, ["Small"]), ["Small", "Big", "Medium"]);
  // A pinned group that no longer exists is ignored.
  assert.deepEqual(orderGroupNames(groups, ["Gone", "Medium"]), ["Medium", "Big", "Small"]);
});

test("detects Xtream playlist URLs and extracts credentials", () => {
  const info = parseXtreamInfo(
    "http://panel.test:8080/get.php?username=bob&password=secret&type=m3u_plus"
  );
  assert.deepEqual(info, {
    baseUrl: "http://panel.test:8080",
    username: "bob",
    password: "secret"
  });
  assert.equal(isXtreamPlaylistUrl("http://panel.test/player_api.php?username=a&password=b"), true);
  // A plain M3U link is not an Xtream panel.
  assert.equal(isXtreamPlaylistUrl("http://example.test/playlist.m3u"), false);
  assert.equal(parseXtreamInfo("http://panel.test/get.php?username=bob"), null);
  assert.equal(parseXtreamInfo("not a url"), null);
});

test("builds credentials from a host/user/pass login form", () => {
  assert.deepEqual(
    xtreamInfoFromCredentials({ host: "panel.test:8080", username: "u", password: "p" }),
    {
      baseUrl: "http://panel.test:8080",
      username: "u",
      password: "p"
    }
  );
  assert.equal(xtreamInfoFromCredentials({ host: "", username: "u", password: "p" }), null);
});

test("builds player_api and live stream URLs", () => {
  const info = { baseUrl: "http://panel.test", username: "u", password: "p" };
  const apiUrl = new URL(buildXtreamPlayerApiUrl(info, "get_live_streams"));
  assert.equal(apiUrl.pathname, "/player_api.php");
  assert.equal(apiUrl.searchParams.get("action"), "get_live_streams");
  assert.equal(apiUrl.searchParams.get("username"), "u");

  // HLS is requested because a raw .ts endpoint will not play in a browser.
  assert.equal(buildXtreamStreamUrl(info, 42), "http://panel.test/live/u/p/42.m3u8");
});

test("maps Xtream live streams onto channels with category names", async () => {
  const info = { baseUrl: "http://panel.test", username: "u", password: "p" };
  const channels = await fetchXtreamLiveChannels({
    info,
    playlistId: "x1",
    fetchJson: async (url) => {
      if (url.includes("get_live_categories")) {
        return [{ category_id: 7, category_name: " Deportes " }];
      }
      return [
        { stream_id: 101, name: "ESPN HD", category_id: 7, epg_channel_id: "espn.us", num: 5 },
        { stream_id: 101, name: "duplicate", category_id: 7 },
        { name: "no id" }
      ];
    }
  });

  assert.equal(channels.length, 1);
  assert.equal(channels[0].id, "x1:101");
  assert.equal(channels[0].group, "Deportes");
  assert.equal(channels[0].tvgId, "espn.us");
  assert.equal(channels[0].streamUrl, "http://panel.test/live/u/p/101.m3u8");
});

test("still returns channels when the categories call fails", async () => {
  const channels = await fetchXtreamLiveChannels({
    info: { baseUrl: "http://panel.test", username: "u", password: "p" },
    fetchJson: async (url) => {
      if (url.includes("get_live_categories")) {
        throw new Error("boom");
      }
      return [{ stream_id: 1, name: "Ch", category_id: 9 }];
    }
  });
  assert.equal(channels.length, 1);
  assert.equal(channels[0].group, "Uncategorized");
});

test("decodes base64 short-EPG titles into now/next", async () => {
  const nowMs = 1_700_000_000_000;
  const encode = (value) => Buffer.from(value, "utf8").toString("base64");
  const result = await fetchXtreamNowNext({
    info: { baseUrl: "http://panel.test", username: "u", password: "p" },
    streamId: 101,
    nowMs,
    fetchJson: async () => ({
      epg_listings: [
        {
          start_timestamp: nowMs / 1000 - 600,
          stop_timestamp: nowMs / 1000 + 600,
          title: encode("Noticiero"),
          description: encode("Resumen")
        },
        {
          start_timestamp: nowMs / 1000 + 600,
          stop_timestamp: nowMs / 1000 + 3600,
          title: encode("Película")
        }
      ]
    })
  });

  assert.equal(result.now.title, "Noticiero");
  assert.equal(result.next.title, "Película");
});

test("parses XMLTV timestamps with and without an offset", () => {
  assert.equal(parseXmltvTimestamp("20260801183000 +0000"), Date.UTC(2026, 7, 1, 18, 30, 0));
  // +0200 means the local wall clock is two hours ahead of UTC.
  assert.equal(parseXmltvTimestamp("20260801183000 +0200"), Date.UTC(2026, 7, 1, 16, 30, 0));
  assert.ok(Number.isNaN(parseXmltvTimestamp("garbage")));
});

const XMLTV = `<?xml version="1.0"?>
<tv>
  <programme start="20260801180000 +0000" stop="20260801190000 +0000" channel="cnn.us">
    <title lang="en">World News</title>
    <desc lang="en">Headlines &amp; analysis</desc>
  </programme>
  <programme start="20260801190000 +0000" stop="20260801200000 +0000" channel="cnn.us">
    <title lang="en"><![CDATA[Late Edition]]></title>
  </programme>
  <programme start="20260801180000 +0000" stop="20260801190000 +0000" channel="other.us">
    <title>Ignored</title>
  </programme>
</tv>`;

test("indexes XMLTV programmes and can filter to wanted channels", () => {
  const all = parseXmltv(XMLTV);
  assert.deepEqual([...all.keys()].sort(), ["cnn.us", "other.us"]);

  const filtered = parseXmltv(XMLTV, { wantedChannelIds: ["cnn.us"] });
  assert.deepEqual([...filtered.keys()], ["cnn.us"]);
  assert.equal(filtered.get("cnn.us").length, 2);
  assert.equal(filtered.get("cnn.us")[0].title, "World News");
  assert.equal(filtered.get("cnn.us")[0].description, "Headlines & analysis");
  assert.equal(filtered.get("cnn.us")[1].title, "Late Edition");
});

test("resolves now and next around a moment", () => {
  const programmes = parseXmltv(XMLTV).get("cnn.us");
  const during = nowNextFor(programmes, Date.UTC(2026, 7, 1, 18, 30));
  assert.equal(during.now.title, "World News");
  assert.equal(during.next.title, "Late Edition");

  const before = nowNextFor(programmes, Date.UTC(2026, 7, 1, 10, 0));
  assert.equal(before.now, null);
  assert.equal(before.next.title, "World News");

  assert.equal(nowNextFor([], Date.now()), null);
});

test("builds a now/next map keyed by channel id, skipping channels without tvg-id", () => {
  const index = parseXmltv(XMLTV);
  const map = buildNowNextMap(
    [
      { id: "pl:1", tvgId: "cnn.us" },
      { id: "pl:2", tvgId: "" },
      { id: "pl:3", tvgId: "unknown.us" }
    ],
    index,
    Date.UTC(2026, 7, 1, 18, 30)
  );
  assert.deepEqual(Object.keys(map), ["pl:1"]);
  assert.equal(map["pl:1"].now.title, "World News");
});

test("reports programme progress as a bounded fraction", () => {
  const programme = { startMs: 0, endMs: 1000 };
  assert.equal(programmeProgress(programme, 500), 0.5);
  assert.equal(programmeProgress(programme, -100), 0);
  assert.equal(programmeProgress(programme, 5000), 1);
  assert.equal(programmeProgress(null, 0), 0);
});

test("filters channels by minimum quality, keeping unlabelled ones", () => {
  const channels = [
    { name: "4K feed", qualityLabel: "4K" },
    { name: "FHD feed", qualityLabel: "FHD" },
    { name: "HD feed", qualityLabel: "HD" },
    { name: "SD feed", qualityLabel: "SD" },
    { name: "Unlabelled feed", qualityLabel: "" }
  ];

  assert.equal(filterChannelsByMinQuality(channels, "ANY").length, 5);

  // 1080p and above: 720p and 480p go, the unlabelled one stays because
  // providers often omit the marker on good streams.
  assert.deepEqual(
    filterChannelsByMinQuality(channels, "FHD").map((c) => c.name),
    ["4K feed", "FHD feed", "Unlabelled feed"]
  );

  assert.deepEqual(
    filterChannelsByMinQuality(channels, "UHD").map((c) => c.name),
    ["4K feed", "Unlabelled feed"]
  );

  assert.deepEqual(
    filterChannelsByMinQuality(channels, "HD").map((c) => c.name),
    ["4K feed", "FHD feed", "HD feed", "Unlabelled feed"]
  );

  // An unknown threshold must not silently drop everything.
  assert.equal(filterChannelsByMinQuality(channels, "nonsense").length, 5);
});

test("a comma inside an attribute value does not corrupt the channel name", () => {
  // Real playlists embed a browser user-agent; "(KHTML, like Gecko)" put a
  // comma inside the attribute list and named the channel "like Gecko)
  // Chrome/146.0.0.0 Safari/537.36".
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
  const playlist = [
    "#EXTM3U",
    `#EXTINF:-1 tvg-id="x.mx" http-user-agent="${ua}" group-title="News",Canal 22`,
    "http://a.test/1",
    '#EXTINF:-1 group-title="News",CNN, en vivo',
    "http://a.test/2"
  ].join("\n");

  const channels = parseM3u(playlist, "pl");
  assert.equal(channels[0].name, "Canal 22");
  // A comma in the title itself is part of the title, not a separator.
  assert.equal(channels[1].name, "CNN, en vivo");
});

test("extinfTitle returns the text after the attribute list", () => {
  assert.equal(extinfTitle('#EXTINF:-1 tvg-id="a",Name'), "Name");
  assert.equal(extinfTitle("#EXTINF:-1,Name"), "Name");
  assert.equal(extinfTitle("#EXTINF:-1 no-comma-here"), "");
});
