// Liveness probing for IPTV channels.
//
// Free public playlists rot continuously: a list that parses perfectly can be a
// third dead by the time it is opened, and a dead row is indistinguishable from
// a live one until it is selected and the player hangs. That is a poor thing to
// hand someone who just wants to watch the news, so channels are probed and the
// dead ones are removed from the list rather than left to fail on Enter.
//
// A probe is a ranged GET rather than a HEAD: many IPTV edges answer HEAD with
// 405 while serving GET fine, and the first two bytes are enough to tell a real
// manifest from an error page. The response body is inspected because a
// surprising number of dead endpoints answer 200 with an HTML "stream offline"
// notice, which a status check alone would accept.

export const PROBE_TIMEOUT_MS = 6000;
export const PROBE_CONCURRENCY = 6;

export const CHANNEL_ALIVE = "alive";
export const CHANNEL_DEAD = "dead";
export const CHANNEL_UNKNOWN = "unknown";

// A probe that failed for a reason that is plausibly local (offline, DNS blip)
// must not condemn the channel, so those resolve to "unknown" and are retried
// later rather than cached as dead.
const HARD_DEAD_STATUSES = new Set([400, 401, 402, 403, 404, 405, 406, 410, 451]);

function looksLikeErrorPage(text = "") {
  const head = String(text || "")
    .slice(0, 200)
    .toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html");
}

/**
 * Probes one stream URL.
 *
 * @returns {Promise<"alive"|"dead"|"unknown">}
 */
export async function probeChannelUrl(url = "", options = {}) {
  const {
    fetchImpl = typeof fetch === "function" ? fetch : null,
    timeoutMs = PROBE_TIMEOUT_MS,
    headers = {}
  } = options;
  const target = String(url || "").trim();
  if (!target || !fetchImpl) {
    return CHANNEL_UNKNOWN;
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), Math.max(1000, Number(timeoutMs) || 0));

  try {
    const response = await fetchImpl(target, {
      method: "GET",
      headers: { ...headers, Range: "bytes=0-511" },
      redirect: "follow",
      cache: "no-store",
      signal: controller?.signal
    });

    if (HARD_DEAD_STATUSES.has(response.status)) {
      return CHANNEL_DEAD;
    }
    if (response.status >= 500) {
      // Provider-side outage: real, but often transient. Do not cache as dead.
      return CHANNEL_UNKNOWN;
    }
    if (!response.ok && response.status !== 206) {
      return CHANNEL_UNKNOWN;
    }

    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    if (contentType.includes("video/") || contentType.includes("application/octet-stream")) {
      return CHANNEL_ALIVE;
    }

    const text = await response.text().catch(() => "");
    if (!text) {
      // 200 with no body at all is not a stream.
      return contentType ? CHANNEL_ALIVE : CHANNEL_UNKNOWN;
    }
    if (text.includes("#EXTM3U") || text.includes("#EXT-X-")) {
      return CHANNEL_ALIVE;
    }
    if (looksLikeErrorPage(text)) {
      return CHANNEL_DEAD;
    }
    // Binary payload (MPEG-TS, fMP4) truncated by the range request.
    return CHANNEL_ALIVE;
  } catch (_) {
    // AbortError means it did not answer inside the budget. On a TV that is
    // indistinguishable from dead as far as the viewer is concerned, but it is
    // also what a congested network looks like, so it stays "unknown" and is
    // re-probed rather than permanently hidden.
    return CHANNEL_UNKNOWN;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes many channels with bounded concurrency.
 *
 * @param {Array<{id:string, streamUrl:string}>} channels
 * @param {object} [options] `onResult({channel, state})` fires as each finishes,
 *   so the list can drop a dead row without waiting for the whole sweep.
 * @returns {Promise<Map<string, string>>} channel id -> state
 */
export async function probeChannels(channels = [], options = {}) {
  const {
    concurrency = PROBE_CONCURRENCY,
    onResult = null,
    shouldStop = null,
    ...probeOptions
  } = options;
  const entries = Array.isArray(channels) ? channels.filter(Boolean) : [];
  const results = new Map();
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < entries.length) {
      if (typeof shouldStop === "function" && shouldStop()) {
        return;
      }
      const channel = entries[nextIndex];
      nextIndex += 1;
      const state = await probeChannelUrl(channel.streamUrl, probeOptions);
      results.set(channel.id, state);
      if (typeof onResult === "function") {
        try {
          onResult({ channel, state });
        } catch (_) {
          // A listener throwing must not abort the sweep.
        }
      }
    }
  };

  const workerCount = Math.min(
    entries.length,
    Math.max(1, Math.trunc(Number(concurrency) || PROBE_CONCURRENCY))
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
