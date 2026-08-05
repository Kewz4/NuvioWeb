// Telling an addon's failure notices apart from its streams.
//
// Addons report their own problems as stream entries — rate limits, timeouts,
// expired keys — because that is the only channel the protocol gives them. For
// a household that just wants to press play, a list where half the rows are
// status messages in English is a list that looks broken, so these are dropped
// before the stream list is built.
//
// Lives in its own module because the rules were previously mirrored into the
// test by hand, and the copies drifted: a real notice shipped because the test's
// copy never learned the rule that caught it.

// An error card's "url" is often the addon's own homepage or repository, put
// there so the notice has somewhere to go. That is not a stream, and treating
// any URL as proof of playability lets these cards through.
const NON_STREAM_HOSTS =
  /(^|\.)(github\.com|gitlab\.com|discord\.gg|discord\.com|ko-fi\.com|patreon\.com|buymeacoffee\.com)$/;

export function hasPlayableTarget(item = {}) {
  if (item.ytId || item.infoHash || item.raw?.infoHash) {
    return true;
  }
  const url = String(item.url || item.externalUrl || "").trim();
  if (!url) {
    return false;
  }
  if (/^magnet:/i.test(url)) {
    return true;
  }
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (_) {
    // Not a URL we can reason about; let the wording decide.
    return false;
  }
  return !NON_STREAM_HOSTS.test(host);
}

/** Whether a stream entry is really an addon reporting a failure. */
export function isAddonErrorPlaceholder(item = {}) {
  if (hasPlayableTarget(item)) {
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
    // "429 - Too Many Requests", "503 - Service Unavailable", and similar.
    /\b[45]\d{2}\b\s*[-:]/.test(text) ||
    /too many requests|rate limit|unauthor|forbidden|timed? ?out|unavailable/.test(text) ||
    // The cross most of them prefix the addon name with.
    /\[\s*(?:❌|✖|✘|x)\s*\]/i.test(text) ||
    /\b(?:no results|not found|failed|error)\b/.test(text)
  );
}
