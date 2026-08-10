// Asking image hosts for the size we are actually going to draw.
//
// Addons hand back whatever URL they please, and a good number of them use
// TMDB's "original" bucket — a full-resolution image for a poster drawn 440
// pixels wide. The download is the smaller half of the cost: decoding happens
// largely on the main thread, so on a TV every oversized poster competes with
// the scroll animation for the one thread that matters.
//
// Measured on Home before this existed: 129 of 132 posters were larger than
// their slot, median 4.65x, around 292 MB of pixels decoded to draw a fraction
// of them.
//
// This is purely a fetch-size change. The image drawn is the same image, and a
// bucket at or above the slot width means it is never upscaled — if anything it
// looks slightly crisper for not being downsampled by the browser.

// TMDB's published widths. Anything not on this list is not a size TMDB serves.
const TMDB_WIDTHS = [92, 154, 185, 342, 500, 780, 1280];

// Focus grows a poster by about one percent, so the headroom only has to cover
// that and a rounding error. Keeping it tight matters: the buckets are far
// apart, and an over-generous margin pushes a 440px slot from w500 to w780 —
// paying for 1.8x the pixels to cover a 1% scale.
const FOCUS_SCALE_HEADROOM = 1.06;

const TMDB_PATH = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)([^/]+)(\/.+)$/i;

/** The smallest published width that still covers `targetWidth`. */
export function pickTmdbWidth(targetWidth = 0) {
  const wanted = Math.ceil(Math.max(0, Number(targetWidth) || 0) * FOCUS_SCALE_HEADROOM);
  if (!wanted) {
    return TMDB_WIDTHS[TMDB_WIDTHS.length - 1];
  }
  return TMDB_WIDTHS.find((width) => width >= wanted) || TMDB_WIDTHS[TMDB_WIDTHS.length - 1];
}

/**
 * Rewrites a TMDB image URL to the size it will actually be drawn at.
 *
 * Anything that is not a TMDB image URL is returned untouched — this must never
 * be the reason a poster fails to load, so every uncertain case is left alone.
 *
 * A URL already asking for a smaller bucket than we need is also left alone:
 * the addon may know something we do not, and upscaling it would look worse
 * than the extra pixels cost.
 */
export function resizeTmdbImage(url = "", targetWidth = 0) {
  const raw = String(url || "").trim();
  if (!raw) {
    return raw;
  }
  const match = TMDB_PATH.exec(raw);
  if (!match) {
    return raw;
  }
  const [, base, currentSize, path] = match;
  const wanted = pickTmdbWidth(targetWidth);

  const currentWidth = /^w(\d+)$/i.exec(currentSize);
  if (currentWidth && Number(currentWidth[1]) <= wanted) {
    return raw;
  }
  return `${base}w${wanted}${path}`;
}
