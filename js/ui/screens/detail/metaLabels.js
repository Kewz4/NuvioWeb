// Localizing the raw metadata values shown on the detail hero.
//
// `status`, `country` and `language` arrive from the metadata provider as
// English text or ISO codes ("Returning Series", "US", "en") and were rendered
// straight to the screen, uppercased. On a Spanish profile that produced
// "RETURNING SERIES" and "US" sitting next to fully translated chrome, which is
// exactly the sort of half-translated screen that makes an app feel foreign.
//
// Status maps onto the existing `*_status_*` keys; country and language use the
// platform's own locale data, which is far more complete than any table shipped
// here and is already loaded on the TV.

// TMDB and Cinemeta disagree on wording for the same state, so both spellings
// map onto one key.
const STATUS_KEYS = {
  ended: "ended",
  canceled: "cancelled",
  cancelled: "cancelled",
  continuing: "continuing",
  ongoing: "continuing",
  running: "continuing",
  "returning series": "returning",
  returning: "returning",
  current: "current",
  released: "released",
  planned: "planned",
  rumored: "rumored",
  "in production": "in_production",
  "post production": "post_production",
  "post-production": "post_production",
  upcoming: "planned",
  pilot: "planned"
};

/**
 * Translated status text for the hero badge.
 *
 * @param {string} status raw provider value
 * @param {string} type "series" or "movie" — the two have parallel key sets
 * @param {function} translate I18n.t
 * @returns {string} localized text, or the original when nothing matches
 */
export function localizeMetaStatus(status = "", type = "series", translate = null) {
  const raw = String(status || "").trim();
  if (!raw) {
    return "";
  }
  const slug = STATUS_KEYS[raw.toLowerCase()];
  if (!slug || typeof translate !== "function") {
    return raw;
  }
  const prefix = type === "movie" ? "movie_status" : "series_status";
  const localized = translate(`${prefix}_${slug}`, {}, { fallback: "" });
  return localized || raw;
}

function displayNameOf(kind, code, locale) {
  try {
    // Intl.DisplayNames is the platform's own table; nothing shipped here would
    // be as complete or as correctly translated.
    const names = new Intl.DisplayNames([locale], { type: kind });
    return names.of(code) || "";
  } catch (_) {
    // Older TV engines lack Intl.DisplayNames; the raw code is still readable.
    return "";
  }
}

/** "US, MX" -> "Estados Unidos, México" for the active locale. */
export function localizeCountryList(value = "", locale = "en") {
  return String(value || "")
    .split(",")
    .map((part) => {
      const code = part.trim();
      if (!code) {
        return "";
      }
      const name = /^[A-Za-z]{2}$/.test(code)
        ? displayNameOf("region", code.toUpperCase(), locale)
        : "";
      return name || code;
    })
    .filter(Boolean)
    .join(", ");
}

/** "en" -> "inglés" for the active locale. Non-codes pass through. */
export function localizeLanguage(value = "", locale = "en") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const name = /^[A-Za-z]{2,3}(-[A-Za-z0-9]+)?$/.test(raw)
    ? displayNameOf("language", raw.toLowerCase(), locale)
    : "";
  return name || raw;
}
