// The screen a paused TV becomes.
//
// A player left paused shows a frozen frame and a control bar forever. On an
// OLED that is a burn-in risk, and on any panel it simply looks like the app
// has hung. After a while of nobody touching anything, the frame gives way to
// artwork and a clock — which is what a television in a living room should look
// like when nobody is watching it.
//
// This module owns only the decision and the rotation. The overlay itself is
// the player's business; keeping the timing here means it can be reasoned about
// without a DOM.

// Long enough that a pause to answer the door does not become a slideshow, short
// enough that a pause forgotten before bed does not burn a frame in.
export const AMBIENT_IDLE_DELAY_MS = 3 * 60 * 1000;
// Slow: this is wallpaper, not a carousel. Anything faster reads as motion in
// the corner of the eye and pulls attention back to a TV nobody is watching.
export const AMBIENT_ROTATE_MS = 45 * 1000;

/**
 * Whether the ambient screen should be showing.
 *
 * @param {object} state
 * @param {boolean} state.paused
 * @param {number} state.idleMs how long since the last remote press
 * @param {boolean} [state.dialogOpen] a menu is open, so someone is present
 * @param {boolean} [state.enabled]
 */
export function shouldShowAmbient({
  paused = false,
  idleMs = 0,
  dialogOpen = false,
  enabled = true
} = {}) {
  if (!enabled || !paused || dialogOpen) {
    return false;
  }
  return Number(idleMs) >= AMBIENT_IDLE_DELAY_MS;
}

/**
 * Artwork to cycle through, best first.
 *
 * Landscape art only: a poster letterboxed onto a 16:9 panel with bars down
 * both sides is worse than the frozen frame it replaced. Falls back to the
 * current title's own backdrop so there is always something to show.
 */
export function buildAmbientArtwork({ current = {}, recent = [] } = {}) {
  const urls = [];
  const push = (value) => {
    const url = String(value || "").trim();
    if (url && !urls.includes(url)) {
      urls.push(url);
    }
  };
  push(current?.background || current?.backdrop);
  (Array.isArray(recent) ? recent : []).forEach((entry) => {
    push(entry?.background || entry?.backdrop || entry?.enrichedMeta?.background);
  });
  return urls;
}

/** Index into the artwork list for a given elapsed time. */
export function ambientArtworkIndex(elapsedMs = 0, count = 0) {
  const total = Math.max(0, Math.trunc(count));
  if (total <= 1) {
    return 0;
  }
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  return Math.floor(elapsed / AMBIENT_ROTATE_MS) % total;
}
