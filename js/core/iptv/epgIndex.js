// XMLTV electronic programme guide parsing.
//
// Deliberately regex-based rather than DOMParser: guide files run to tens of
// megabytes and the TV's DOM parser both blocks the UI thread and balloons
// memory. Scanning for <programme> blocks lets us keep only the channels we
// actually have and discard everything else as we go.

const PROGRAMME_PATTERN = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
const SELF_CLOSING_PROGRAMME_PATTERN = /<programme\b([^>]*)\/>/gi;

function attr(source = "", name = "") {
  const match = String(source || "").match(
    new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  return match?.[1] ?? match?.[2] ?? "";
}

function decodeXmlEntities(value = "") {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/gi, "&")
    .trim();
}

function firstTagText(body = "", tag = "") {
  const match = String(body || "").match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXmlEntities(match[1]) : "";
}

/**
 * Parses an XMLTV timestamp such as "20260801183000 +0000".
 * @returns {number} epoch milliseconds, or NaN.
 */
export function parseXmltvTimestamp(value = "") {
  const text = String(value || "").trim();
  const match = text.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-])(\d{2})(\d{2}))?/
  );
  if (!match) {
    return NaN;
  }
  const [, year, month, day, hour, minute, second, sign, offsetHours, offsetMinutes] = match;
  const utcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second || 0)
  );
  if (!sign) {
    // No offset given: XMLTV says treat as local time.
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second || 0)
    ).getTime();
  }
  const offsetMs = (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60000;
  return sign === "+" ? utcMs - offsetMs : utcMs + offsetMs;
}

const CHANNEL_PATTERN = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/gi;
const DISPLAY_NAME_PATTERN = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/gi;

/**
 * The `<channel>` declarations in a guide.
 *
 * Read separately from the programmes so a channel can be matched by *name*
 * before the (much larger) programme scan runs — the guide can then be narrowed
 * to the handful of channels the playlist actually contains.
 *
 * @returns {Map<string, {names: string[]}>} channel id -> display names
 */
export function parseXmltvChannels(xml = "") {
  const text = String(xml || "");
  const channels = new Map();
  CHANNEL_PATTERN.lastIndex = 0;
  let match;
  while ((match = CHANNEL_PATTERN.exec(text)) !== null) {
    const id = decodeXmlEntities(attr(match[1], "id"));
    if (!id) {
      continue;
    }
    const names = [];
    DISPLAY_NAME_PATTERN.lastIndex = 0;
    let nameMatch;
    while ((nameMatch = DISPLAY_NAME_PATTERN.exec(match[2])) !== null) {
      const name = decodeXmlEntities(nameMatch[1]);
      if (name && !names.includes(name)) {
        names.push(name);
      }
    }
    channels.set(id, { names });
  }
  return channels;
}

/** The channel ids that actually carry a `<programme>`, cheaply. */
export function parseXmltvProgrammeChannelIds(xml = "") {
  const ids = new Set();
  const text = String(xml || "");
  const pattern = /<programme\b[^>]*\bchannel\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const id = decodeXmlEntities(match[1] ?? match[2] ?? "");
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Builds a channel-id -> sorted programmes index.
 *
 * @param {string} xml
 * @param {object} [options]
 * @param {Set<string>|Array<string>} [options.wantedChannelIds] keep only these
 *   channels; omit to keep everything.
 * @param {number} [options.windowStartMs] drop programmes ending before this.
 * @param {number} [options.windowEndMs] drop programmes starting after this.
 *   The window exists because a national guide holds a week of schedule per
 *   channel and the tab only ever shows now and next; keeping it all is tens of
 *   megabytes of objects the TV cannot spare.
 * @returns {Map<string, Array<{startMs:number,endMs:number,title:string,description:string}>>}
 */
export function parseXmltv(
  xml = "",
  { wantedChannelIds = null, windowStartMs = null, windowEndMs = null } = {}
) {
  const wanted =
    wantedChannelIds == null
      ? null
      : wantedChannelIds instanceof Set
        ? wantedChannelIds
        : new Set(wantedChannelIds);

  const index = new Map();
  const text = String(xml || "");

  const addProgramme = (attrs, body) => {
    const channelId = attr(attrs, "channel");
    if (!channelId || (wanted && !wanted.has(channelId))) {
      return;
    }
    const startMs = parseXmltvTimestamp(attr(attrs, "start"));
    const endMs = parseXmltvTimestamp(attr(attrs, "stop"));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return;
    }
    if (Number.isFinite(windowStartMs) && endMs <= Number(windowStartMs)) {
      return;
    }
    if (Number.isFinite(windowEndMs) && startMs >= Number(windowEndMs)) {
      return;
    }
    if (!index.has(channelId)) {
      index.set(channelId, []);
    }
    index.get(channelId).push({
      startMs,
      endMs,
      title: firstTagText(body, "title"),
      description: firstTagText(body, "desc")
    });
  };

  PROGRAMME_PATTERN.lastIndex = 0;
  let match;
  while ((match = PROGRAMME_PATTERN.exec(text)) !== null) {
    addProgramme(match[1], match[2]);
  }

  SELF_CLOSING_PROGRAMME_PATTERN.lastIndex = 0;
  while ((match = SELF_CLOSING_PROGRAMME_PATTERN.exec(text)) !== null) {
    addProgramme(match[1], "");
  }

  index.forEach((programmes) => programmes.sort((left, right) => left.startMs - right.startMs));
  return index;
}

/** The programme airing at `nowMs` and the one after it. */
export function nowNextFor(programmes = [], nowMs = Date.now()) {
  if (!programmes.length) {
    return null;
  }
  const now = programmes.find((item) => item.startMs <= nowMs && item.endMs > nowMs) || null;
  const next = programmes.find((item) => item.startMs > nowMs) || null;
  return now || next ? { now, next } : null;
}

/**
 * Builds a channelId -> {now, next} map for the supplied channels.
 *
 * @param {Array<object>} channels
 * @param {Map<string, Array<object>>} epgIndex guide id -> programmes
 * @param {number} [nowMs]
 * @param {function(object): string} [resolveGuideId] maps a channel to its guide
 *   id. Defaults to the channel's own tvg-id, which is right for a guide the
 *   provider ships alongside its playlist; shared community guides use a
 *   name-based resolver instead.
 */
export function buildNowNextMap(
  channels = [],
  epgIndex = new Map(),
  nowMs = Date.now(),
  resolveGuideId = null
) {
  const result = {};
  channels.forEach((channel) => {
    const guideId =
      typeof resolveGuideId === "function"
        ? String(resolveGuideId(channel) || "")
        : String(channel?.tvgId || "").trim();
    if (!guideId) {
      return;
    }
    const programmes = epgIndex.get(guideId);
    if (!programmes?.length) {
      return;
    }
    const nowNext = nowNextFor(programmes, nowMs);
    if (nowNext) {
      result[channel.id] = nowNext;
    }
  });
  return result;
}

/** Fraction (0..1) of the current programme already elapsed, for a progress bar. */
export function programmeProgress(programme, nowMs = Date.now()) {
  if (!programme) {
    return 0;
  }
  const total = Number(programme.endMs) - Number(programme.startMs);
  if (!(total > 0)) {
    return 0;
  }
  return Math.max(0, Math.min(1, (Number(nowMs) - Number(programme.startMs)) / total));
}
