import assert from "node:assert/strict";
import test from "node:test";

import { pickTmdbWidth, resizeTmdbImage } from "./tmdbImageSize.js";

const POSTER = "https://image.tmdb.org/t/p/original/abc123.jpg";

test("an original-size poster is asked for at the size it is drawn", () => {
  // The case that hurt most: a full-resolution image decoded to draw at 440px.
  assert.equal(resizeTmdbImage(POSTER, 440), "https://image.tmdb.org/t/p/w500/abc123.jpg");
});

test("the chosen width always covers the slot", () => {
  // Never smaller than the slot, or the browser upscales and it looks soft.
  [80, 150, 200, 400, 700, 1100].forEach((slot) => {
    assert.ok(pickTmdbWidth(slot) >= slot, `${slot} -> ${pickTmdbWidth(slot)}`);
  });
});

test("there is headroom for the focus scale, but not a bucket's worth", () => {
  // A card grows about one percent when focused; without headroom the browser
  // resamples it mid-animation, which is exactly when it can least afford to.
  // Too much headroom is its own bug: it buys the next bucket up for nothing.
  assert.ok(pickTmdbWidth(500) > 500);
  assert.equal(pickTmdbWidth(440), 500, "a 1% scale must not cost the w780 bucket");
});

test("a URL already asking for less is left alone", () => {
  // The addon may know something we do not, and upscaling looks worse than the
  // pixels would have cost.
  const small = "https://image.tmdb.org/t/p/w185/abc123.jpg";
  assert.equal(resizeTmdbImage(small, 440), small);
});

test("a URL already at the right size is untouched", () => {
  const exact = "https://image.tmdb.org/t/p/w500/abc123.jpg";
  assert.equal(resizeTmdbImage(exact, 440), exact);
});

test("non-TMDB images are never rewritten", () => {
  // This must never be the reason a poster fails to load, so anything uncertain
  // is returned exactly as it arrived.
  [
    "https://i.imgur.com/FJKAcCn.png",
    "https://example.com/t/p/original/x.jpg",
    "assets/icons/imdb_logo_2016.svg",
    "",
    null,
    undefined
  ].forEach((value) => {
    assert.equal(resizeTmdbImage(value, 440), value ? String(value).trim() : "");
  });
});

test("http and https are both recognised", () => {
  assert.equal(
    resizeTmdbImage("http://image.tmdb.org/t/p/original/a.jpg", 200),
    "http://image.tmdb.org/t/p/w342/a.jpg"
  );
});

test("an unknown slot width asks for the largest rather than the smallest", () => {
  // Guessing small would ship a blurry poster; guessing large only costs
  // bandwidth, and the caller passing nothing is a bug worth seeing.
  assert.equal(pickTmdbWidth(0), 1280);
  assert.equal(resizeTmdbImage(POSTER, 0), "https://image.tmdb.org/t/p/w1280/abc123.jpg");
});

test("a backdrop-sized slot still resolves to a real bucket", () => {
  assert.equal(resizeTmdbImage(POSTER, 1920), "https://image.tmdb.org/t/p/w1280/abc123.jpg");
});

test("paths with folders survive the rewrite", () => {
  assert.equal(
    resizeTmdbImage("https://image.tmdb.org/t/p/original/x/y/z.png", 150),
    "https://image.tmdb.org/t/p/w185/x/y/z.png"
  );
});
