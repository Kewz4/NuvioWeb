// The overlay shown while a full subtitle track is being generated.
//
// Generation holds playback for minutes on a long episode, so a one-line toast
// is not enough: with no visible progress the TV looks frozen, and the most
// likely reaction is to press buttons until something happens. This shows what
// is happening, how far along it is, roughly how much longer, and how to stop.
//
// Kept free of the player's internals so the timing maths can be unit tested.

const MIN_SAMPLES_FOR_ETA = 2;
// Rate is averaged over a trailing window rather than the whole run: the first
// request carries model warm-up and a cold rate-limit budget, so a lifetime
// average reads far too pessimistic for the remaining nine tenths.
const RATE_WINDOW_SAMPLES = 6;

/**
 * Tracks completion rate and projects a remaining time.
 *
 * Progress arrives in batches, and batches pause for token budgeting, so the
 * instantaneous rate swings wildly. The estimate is deliberately coarse and
 * only ever shown rounded.
 */
export function createProgressEstimator(nowMs = Date.now()) {
  const samples = [];
  let startedAt = nowMs;

  return {
    reset(atMs = Date.now()) {
      samples.length = 0;
      startedAt = atMs;
    },

    record(done = 0, atMs = Date.now()) {
      const last = samples[samples.length - 1];
      // Progress callbacks fire more than once per batch (pacing re-reports the
      // same count); only a real advance carries rate information.
      if (last && done <= last.done) {
        return;
      }
      samples.push({ done, atMs });
      if (samples.length > RATE_WINDOW_SAMPLES) {
        samples.shift();
      }
    },

    /** Lines per millisecond over the trailing window, or 0 when unknown. */
    rate() {
      if (samples.length < MIN_SAMPLES_FOR_ETA) {
        return 0;
      }
      const first = samples[0];
      const last = samples[samples.length - 1];
      const elapsed = last.atMs - first.atMs;
      const advanced = last.done - first.done;
      return elapsed > 0 && advanced > 0 ? advanced / elapsed : 0;
    },

    /** Milliseconds remaining, or null while there is nothing to base it on. */
    remainingMs(done = 0, total = 0) {
      const outstanding = Math.max(0, Number(total) - Number(done));
      if (!outstanding) {
        return 0;
      }
      const rate = this.rate();
      if (!rate) {
        return null;
      }
      return Math.round(outstanding / rate);
    },

    elapsedMs(atMs = Date.now()) {
      return Math.max(0, atMs - startedAt);
    }
  };
}

/**
 * A short human duration: "2 min", "45 s", "1 h 5 min".
 *
 * Rounded generously and never shown to the second — a countdown that ticks
 * backwards because one batch was slow is worse than no number at all.
 */
export function formatRemaining(ms, translate) {
  const t = typeof translate === "function" ? translate : (_key, _params, fallback) => fallback;
  if (!Number.isFinite(ms) || ms < 0) {
    return "";
  }
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 20) {
    return t("subtitle_generate_eta_almost", {}, "almost done");
  }
  if (totalSeconds < 90) {
    const seconds = Math.ceil(totalSeconds / 10) * 10;
    return t("subtitle_generate_eta_seconds", { 1: seconds }, `about ${seconds} s left`);
  }
  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) {
    return t(
      "subtitle_generate_eta_minutes",
      { 1: totalMinutes },
      `about ${totalMinutes} min left`
    );
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return t(
    "subtitle_generate_eta_hours",
    { 1: hours, 2: minutes },
    `about ${hours} h ${minutes} min left`
  );
}

/** Whole-percent completion, clamped so a rounding slip cannot overfill the bar. */
export function progressPercent(done = 0, total = 0) {
  const totalLines = Number(total) || 0;
  if (totalLines <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((Number(done) / totalLines) * 100)));
}
