import assert from "node:assert/strict";
import test from "node:test";

import { isAddonErrorPlaceholder } from "./streamErrorPlaceholder.js";

test("an addon reporting a rate limit is hidden", () => {
  assert.equal(
    isAddonErrorPlaceholder({ name: "[❌] AnimeTosho", description: "429 - Too Many Requests" }),
    true
  );
});

test("other failure wordings are hidden too", () => {
  const hidden = [
    { name: "[X] Torrentio", description: "503 - Service Unavailable" },
    { name: "Comet", description: "Unauthorized" },
    { name: "MediaFusion", description: "Request timed out" },
    { name: "Jackett", description: "No results" }
  ];
  hidden.forEach((item) => assert.equal(isAddonErrorPlaceholder(item), true, item.name));
});

test("anything playable is never hidden, whatever it is called", () => {
  // The decisive test: a real stream must survive even if its title reads like
  // an error, because hiding a working result is far worse than showing a bad
  // one.
  assert.equal(
    isAddonErrorPlaceholder({
      name: "[❌] Error 404 (2020)",
      description: "429 - Too Many Requests",
      url: "https://cdn.test/movie.mkv"
    }),
    false
  );
  assert.equal(isAddonErrorPlaceholder({ name: "Fatal Error", infoHash: "abc123" }), false);
  assert.equal(isAddonErrorPlaceholder({ name: "Time Out", externalUrl: "magnet:?xt=x" }), false);
});

test("an ordinary unplayable entry with no error wording is left alone", () => {
  // Only entries that both cannot play AND say they failed are dropped.
  assert.equal(isAddonErrorPlaceholder({ name: "Dune 2160p HDR", description: "12.4 GB" }), false);
  assert.equal(isAddonErrorPlaceholder({}), false);
});

test("a notice linking to the addon's own repo is still a notice", () => {
  // Seen in the wild: AIOStreams reports a rate limit and points the card at
  // its GitHub page, so "it has a url" was never proof of a playable stream.
  assert.equal(
    isAddonErrorPlaceholder({
      name: "[❌] AnimeTosho Auto",
      title: "429 - Too Many Requests",
      url: "https://github.com/Viren070/AIOStreams"
    }),
    true
  );
});

test("funding and chat links do not rescue an error card either", () => {
  ["https://discord.gg/abc", "https://ko-fi.com/someone", "https://patreon.com/someone"].forEach(
    (url) => {
      assert.equal(isAddonErrorPlaceholder({ name: "[❌] Addon failed", url }), true, url);
    }
  );
});

test("a real stream url on a normal host is left alone", () => {
  assert.equal(
    isAddonErrorPlaceholder({
      name: "Error.Of.Judgment.2019.1080p",
      url: "https://cdn.example.com/stream/abc.mkv"
    }),
    false
  );
});

test("a magnet link is playable however the title reads", () => {
  assert.equal(
    isAddonErrorPlaceholder({ name: "[❌] failed", url: "magnet:?xt=urn:btih:abc" }),
    false
  );
});

test("an unparseable url falls through to the wording", () => {
  assert.equal(isAddonErrorPlaceholder({ name: "[❌] 503 - Unavailable", url: "not a url" }), true);
  assert.equal(isAddonErrorPlaceholder({ name: "The Matrix 1080p", url: "not a url" }), false);
});
