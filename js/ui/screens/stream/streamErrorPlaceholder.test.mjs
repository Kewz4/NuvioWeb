import assert from "node:assert/strict";
import test from "node:test";

// The predicate is defined inside the screen module, which pulls in the DOM.
// It is small and pure, so it is mirrored here to lock the behaviour down; the
// screen's copy is the one under review in code, this guards the rules.
function isAddonErrorPlaceholder(item = {}) {
  const playable = item.url || item.externalUrl || item.ytId || item.infoHash || item.raw?.infoHash;
  if (playable) {
    return false;
  }
  const text = [item.name, item.title, item.description, item.addonName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text) {
    return false;
  }
  return (
    /\b[45]\d{2}\b\s*[-:]/.test(text) ||
    /too many requests|rate limit|unauthor|forbidden|timed? ?out|unavailable/.test(text) ||
    /\[\s*(?:\u274c|\u2716|\u2718|x)\s*\]/i.test(text) ||
    /\b(?:no results|not found|failed|error)\b/.test(text)
  );
}

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
