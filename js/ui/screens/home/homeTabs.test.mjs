import assert from "node:assert/strict";
import test from "node:test";

import {
  filterByTabType,
  getHomeTab,
  isHomeTabRoute,
  showsHomeChrome,
  tabAcceptsType
} from "./homeTabs.js";

test("home is not a tab, so it filters nothing", () => {
  assert.equal(getHomeTab("home"), null);
  assert.equal(isHomeTabRoute("home"), false);
  assert.equal(tabAcceptsType("home", "anything"), true);
  const rows = [{ type: "movie" }, { type: "sport" }];
  assert.deepEqual(filterByTabType("home", rows), rows);
});

test("each tab takes only its own kind", () => {
  assert.equal(tabAcceptsType("series", "series"), true);
  assert.equal(tabAcceptsType("series", "movie"), false);
  assert.equal(tabAcceptsType("movies", "movie"), true);
  assert.equal(tabAcceptsType("movies", "series"), false);
  assert.equal(tabAcceptsType("sports", "sport"), true);
  assert.equal(tabAcceptsType("sports", "movie"), false);
});

test("anime rows land on the tab someone would look for them on", () => {
  // The metadata addons split these out; without the alias the rows would exist
  // and be reachable from nowhere.
  assert.equal(tabAcceptsType("series", "anime.series"), true);
  assert.equal(tabAcceptsType("movies", "anime.movie"), true);
  assert.equal(tabAcceptsType("series", "anime.movie"), false);
});

test("type matching ignores case", () => {
  assert.equal(tabAcceptsType("series", "Anime.Series"), true);
  assert.equal(tabAcceptsType("movies", "MOVIE"), true);
});

test("an addon calling its fixtures events still shows under Deportes", () => {
  assert.equal(tabAcceptsType("sports", "events"), true);
  assert.equal(tabAcceptsType("sports", "event"), true);
});

test("a catalog with no type is never shown on a filtered tab", () => {
  // Better absent than dropped into the wrong shelf.
  assert.equal(tabAcceptsType("series", ""), false);
  assert.equal(tabAcceptsType("movies", null), false);
});

test("filtering keeps order and drops the rest", () => {
  const rows = [
    { type: "movie", id: "a" },
    { type: "series", id: "b" },
    { type: "sport", id: "c" },
    { type: "series", id: "d" }
  ];
  assert.deepEqual(
    filterByTabType("series", rows).map((row) => row.id),
    ["b", "d"]
  );
  assert.deepEqual(
    filterByTabType("sports", rows).map((row) => row.id),
    ["c"]
  );
});

test("the hero and Continue Watching belong to Home alone", () => {
  assert.equal(showsHomeChrome("home"), true);
  ["series", "movies", "sports"].forEach((route) => {
    assert.equal(showsHomeChrome(route), false, route);
  });
});

test("every tab names a distinct preference scope", () => {
  // Two tabs sharing a scope would silently reorder each other.
  const scopes = ["series", "movies", "sports"].map((route) => getHomeTab(route).prefsScope);
  assert.equal(new Set(scopes).size, scopes.length);
});

test("filtering never hands back the caller's own array", () => {
  // Home is a pass-through, and returning the input meant a caller that emptied
  // the result to refill it emptied its own source too — which is exactly how
  // Home lost every catalog row.
  const rows = [{ type: "movie" }, { type: "series" }];
  ["home", "series", "movies", "sports"].forEach((route) => {
    assert.notEqual(filterByTabType(route, rows), rows, route);
  });
  assert.equal(rows.length, 2, "source must be untouched");
});

test("emptying the result leaves the source intact", () => {
  const rows = [{ type: "movie" }, { type: "series" }];
  const filtered = filterByTabType("home", rows);
  filtered.length = 0;
  assert.equal(rows.length, 2);
});
