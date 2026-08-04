const MAX_PREVIEW_TILES = 40;
const ACTION_VERSION = 1;

// U+25B6 BLACK RIGHT-POINTING TRIANGLE: present in effectively every system
// font, unlike the colour play emoji, and instantly readable as "resume".
const CONTINUE_WATCHING_BADGE = Object.freeze({ icon: "▶", label: "Sigue viendo" });

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function numberOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function isSeriesType(value) {
  const normalized = String(value || "").toLowerCase();
  return normalized === "series" || normalized === "tv";
}

export function isSupportedPreviewImageUrl(value) {
  const normalized = String(value || "").trim();
  if (/^https?:\/\/.+\.(?:jpe?g|png)(?:[?#].*)?$/i.test(normalized)) {
    return true;
  }
  // Cinemeta serves its poster/backdrop/logo images from this verified host
  // with an extensionless `/img` suffix.
  return /^https:\/\/images\.metahub\.space\/(?:poster|background|logo)\/[^/?#]+\/[^/?#]+\/img(?:[?#].*)?$/i.test(
    normalized
  );
}

export function normalizePreviewImageUrl(value) {
  const normalized = String(value || "").trim();
  if (!isSupportedPreviewImageUrl(normalized)) {
    return "";
  }
  return normalized
    .replace(/^(https?:\/\/image\.tmdb\.org\/t\/p\/)(?:original|w\d+)(\/)/i, "$1w500$2")
    .replace(
      /^(https:\/\/images\.metahub\.space\/(?:poster|background)\/)(?:original|large|medium)(\/)/i,
      "$1small$2"
    );
}

function resolvePreviewImage(item = {}) {
  const landscapeCandidates = [
    item.background,
    item.backdrop,
    item.backdropUrl,
    item.landscapePoster,
    item.thumbnail,
    item.episodeThumbnail
  ];
  const portraitCandidates = [item.poster, item.posterUrl];
  const landscape = landscapeCandidates.map(normalizePreviewImageUrl).find(Boolean);
  if (landscape) {
    return { imageUrl: landscape, imageRatio: "16by9" };
  }
  const portrait = portraitCandidates.map(normalizePreviewImageUrl).find(Boolean);
  if (portrait) {
    return { imageUrl: portrait, imageRatio: "2by3" };
  }
  return null;
}

function encodeAction(action = {}) {
  return JSON.stringify({
    nuvioPreview: ACTION_VERSION,
    ...action
  });
}

/**
 * Prefixes a tile title with the reason it is on screen.
 *
 * Samsung draws the card itself: the only text we control is `title` and
 * `subtitle`, and Tizen 6.5's launcher flattens our sections into one strip, so
 * the section header the reason would normally live in is never shown. Without
 * a prefix every card looks like an unexplained recommendation.
 *
 * The prefix is kept SHORT on purpose. A card truncates its title at roughly
 * thirty characters, and the old format ("Top 10 de Netflix · Películas · Wicked")
 * spent all of them on the category, so the one thing the viewer was actually
 * looking for — the film's name — was always the part cut off.
 *
 * Glyphs are drawn from the geometric-shapes block rather than emoji: colour
 * emoji fall back to an empty box on some AU8000 firmware, and a box is worse
 * than no icon at all.
 */
function applyTileBadge(tile, badge = {}, rank = null) {
  if (!tile) {
    return null;
  }
  const itemTitle = firstNonEmpty(tile.title);
  if (!itemTitle) {
    return tile;
  }
  const icon = firstNonEmpty(badge.icon);
  const label = firstNonEmpty(badge.label);
  const rankedLabel =
    label && Number.isFinite(rank) ? `#${Math.trunc(rank)} ${label}` : label || "";
  const prefix = [icon, rankedLabel].filter(Boolean).join(" ");
  return {
    ...tile,
    title: prefix ? `${prefix} · ${itemTitle}` : itemTitle
  };
}

/** "faltan 23 min" — how much of the episode is left, which is what a viewer weighs. */
function formatRemainingWatchTime(item = {}) {
  const durationMs = Number(item.durationMs || 0);
  const positionMs = Number(item.positionMs || 0);
  if (!(durationMs > 0) || !(positionMs >= 0) || positionMs >= durationMs) {
    return "";
  }
  const remainingMinutes = Math.round((durationMs - positionMs) / 60000);
  if (remainingMinutes < 1) {
    return "casi al final";
  }
  if (remainingMinutes < 60) {
    return `faltan ${remainingMinutes} min`;
  }
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return minutes ? `faltan ${hours} h ${minutes} min` : `faltan ${hours} h`;
}

function formatEpisodeSubtitle(item = {}) {
  if (!isSeriesType(item.contentType || item.type)) {
    return "";
  }
  const season = numberOrNull(item.season ?? item.seasonNumber);
  const episode = numberOrNull(item.episode ?? item.episodeNumber);
  if (season == null || episode == null) {
    return firstNonEmpty(item.episodeTitle);
  }
  const code = `T${Math.max(0, Math.trunc(season))} E${Math.max(0, Math.trunc(episode))}`;
  return firstNonEmpty(item.episodeTitle) ? `${code} · ${item.episodeTitle}` : code;
}

/** Percentage watched, derived from position/duration when not stored. */
function resolveProgressPercent(item = {}) {
  const stored = numberOrNull(item.progressPercent);
  if (stored != null) {
    return stored;
  }
  // Continue Watching entries arrive in several shapes: the Trakt path carries a
  // percentage, the local store carries milliseconds, and enrichment nests the
  // metadata rather than merging it. Reading only one of those left the resume
  // bar undrawn on most entries.
  const meta = item.enrichedMeta && typeof item.enrichedMeta === "object" ? item.enrichedMeta : {};
  const pick = (...names) => {
    for (const name of names) {
      const value = Number(item[name] ?? meta[name] ?? 0);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    return 0;
  };
  const durationMs = pick("durationMs") || pick("durationSeconds", "duration") * 1000;
  const positionMs = pick("positionMs") || pick("positionSeconds", "position") * 1000;
  if (!(durationMs > 0) || !(positionMs > 0)) {
    return null;
  }
  return Math.max(0, Math.min(100, (positionMs / durationMs) * 100));
}

function buildContinueWatchingTile(item = {}, position = 0) {
  const meta = item.enrichedMeta && typeof item.enrichedMeta === "object" ? item.enrichedMeta : {};
  const merged = { ...item, ...meta };
  const itemId = firstNonEmpty(item.contentId, meta.id, item.id);
  const itemType = isSeriesType(item.contentType || meta.type) ? "series" : "movie";
  const image = resolvePreviewImage(merged);
  if (!itemId || !image) {
    return null;
  }
  // Locally stored progress keeps position and duration but no percentage;
  // only the Trakt path carries one. Deriving it here means the resume bar is
  // drawn for every entry rather than just the synced ones.
  const progressPercent = resolveProgressPercent(item);
  const episodeSubtitle = formatEpisodeSubtitle(item);
  const subtitleParts = [];
  if (episodeSubtitle) {
    subtitleParts.push(episodeSubtitle);
  }
  // "faltan 23 min" answers the question actually being asked ("do I have time
  // for this?"); "42% visto" makes the viewer do the arithmetic. The percentage
  // stays as the fallback for entries saved without a duration.
  const remaining = formatRemainingWatchTime(item);
  if (remaining) {
    subtitleParts.push(remaining);
  } else if (progressPercent != null) {
    subtitleParts.push(`${Math.max(0, Math.min(100, Math.round(progressPercent)))}% visto`);
  }
  return {
    title: firstNonEmpty(meta.name, meta.title, item.title, item.name, itemId),
    subtitle: subtitleParts.join(" · "),
    image_url: image.imageUrl,
    image_ratio: image.imageRatio,
    action_data: encodeAction({
      kind: "media",
      source: "continue-watching",
      previewInstance: `continue-watching:${position}`,
      itemId,
      itemType,
      imdbId: item.imdbId || meta.imdbId || null,
      tmdbId: item.tmdbId || meta.tmdbId || null,
      traktId: item.traktId || meta.traktId || null,
      title: firstNonEmpty(meta.name, meta.title, item.title, item.name, itemId),
      resumePositionMs: Number(item.positionMs || 0) || 0,
      resumeDurationMs: Number(item.durationMs || 0) || 0,
      resumeProgressPercent: progressPercent,
      resumeVideoId: item.videoId || null,
      resumeSeason: numberOrNull(item.season ?? item.seasonNumber),
      resumeEpisode: numberOrNull(item.episode ?? item.episodeNumber)
    }),
    is_playable: true,
    // Consumed by the artwork compositor and stripped before the payload is
    // sent: Samsung's tile schema has no field for it.
    resume_progress_percent: progressPercent,
    position
  };
}

function buildCatalogTile(item = {}, position = 0, sectionKey = "catalog", reason = "") {
  const itemId = firstNonEmpty(item.id, item.contentId);
  const itemType = isSeriesType(item.type || item.apiType) ? "series" : "movie";
  const image = resolvePreviewImage(item);
  if (!itemId || !image) {
    return null;
  }
  const kindLabel = itemType === "series" ? "Serie" : "Película";
  return {
    title: firstNonEmpty(item.name, item.title, itemId),
    // The title carries a short badge so the film's own name survives
    // truncation; the subtitle has room for the reason spelled out.
    subtitle: [firstNonEmpty(reason), kindLabel].filter(Boolean).join(" · "),
    image_url: image.imageUrl,
    image_ratio: image.imageRatio,
    action_data: encodeAction({
      kind: "media",
      source: "xperience",
      previewInstance: `${sectionKey}:${position}`,
      itemId,
      itemType,
      title: firstNonEmpty(item.name, item.title, itemId)
    }),
    is_playable: false,
    position
  };
}

function buildFolderTile(section = {}, shortcut = {}, position = 0, addon = {}) {
  const imageUrl = normalizePreviewImageUrl(shortcut.imageUrl);
  if (!section.collectionId || !shortcut.folderId || !imageUrl) {
    return null;
  }
  return {
    title: firstNonEmpty(shortcut.title, "Colección"),
    subtitle: firstNonEmpty(section.title),
    image_url: imageUrl,
    image_ratio: "16by9",
    action_data: encodeAction({
      kind: "collection-folder",
      source: "xperience",
      previewInstance: `${firstNonEmpty(section.key, section.collectionId)}:${position}`,
      collectionId: section.collectionId,
      folderId: shortcut.folderId,
      collectionTitle: section.title || "",
      title: shortcut.title || "",
      fallbackCatalog: {
        addonId: addon.id || "",
        addonName: addon.name || "Xperience",
        catalogId: shortcut.fallbackCatalogId || "",
        catalogName: shortcut.title || "",
        type: shortcut.fallbackType || "movie"
      }
    }),
    is_playable: false,
    position
  };
}

function trimToTileLimit(sections = []) {
  let remaining = MAX_PREVIEW_TILES;
  return sections
    .map((section) => {
      if (remaining <= 0) {
        return null;
      }
      const tiles = (Array.isArray(section.tiles) ? section.tiles : []).slice(0, remaining);
      remaining -= tiles.length;
      return tiles.length ? { ...section, tiles } : null;
    })
    .filter(Boolean);
}

export function buildSmartHubPreviewPayload({
  continueWatching = [],
  continueWatchingLimit = 3,
  catalogSections = [],
  folderSections = [],
  addon = {}
} = {}) {
  const sections = [];
  const continueSectionTitle = "Continuar viendo";
  const continueTiles = (Array.isArray(continueWatching) ? continueWatching : [])
    .map((item, index) => buildContinueWatchingTile(item, index))
    .map((tile) => applyTileBadge(tile, CONTINUE_WATCHING_BADGE))
    .filter(Boolean)
    .slice(0, Math.max(0, Number(continueWatchingLimit || 0)));
  if (continueTiles.length) {
    sections.push({
      title: continueSectionTitle,
      title_display_mode: "AlwaysOn",
      badgeKey: "continueWatching",
      position: 0,
      tiles: continueTiles
    });
  }

  (Array.isArray(catalogSections) ? catalogSections : []).forEach((section, sectionIndex) => {
    const sectionTitle = firstNonEmpty(section.title, "Xperience");
    const badge = {
      icon: firstNonEmpty(section.badgeIcon),
      label: firstNonEmpty(section.badgeLabel, sectionTitle)
    };
    const tiles = (Array.isArray(section.items) ? section.items : [])
      .map((item, index) =>
        buildCatalogTile(
          item,
          index,
          firstNonEmpty(section.key, sectionTitle),
          firstNonEmpty(section.reason)
        )
      )
      .map((tile, index) => applyTileBadge(tile, badge, section.showRank ? index + 1 : null))
      .filter(Boolean)
      .slice(0, Math.max(0, Number(section.limit || section.items.length || 0)));
    if (tiles.length) {
      sections.push({
        title: sectionTitle,
        title_display_mode: "AlwaysOn",
        badgeKey: firstNonEmpty(section.badgeKey),
        position: sectionIndex + 1,
        tiles
      });
    }
  });

  const folderPositionOffset = 1 + (Array.isArray(catalogSections) ? catalogSections.length : 0);
  (Array.isArray(folderSections) ? folderSections : []).forEach((section, sectionIndex) => {
    const sectionTitle = firstNonEmpty(section.title, "Colecciones");
    const tiles = (Array.isArray(section.shortcuts) ? section.shortcuts : [])
      .map((shortcut, index) => buildFolderTile(section, shortcut, index, addon))
      // Folder tiles keep their own name unprefixed: "Marvel" and "Netflix"
      // already say what they are, and "Studios · Marvel" only spends
      // characters. The section name still rides along in the subtitle.
      .filter(Boolean);
    if (tiles.length) {
      sections.push({
        title: sectionTitle,
        title_display_mode: "AlwaysOn",
        position: folderPositionOffset + sectionIndex,
        tiles
      });
    }
  });

  return { sections: trimToTileLimit(sections) };
}

function parseJsonValue(value) {
  let current = value;
  for (let depth = 0; depth < 6; depth += 1) {
    if (Array.isArray(current)) {
      current = current[0];
      continue;
    }
    if (typeof current === "string") {
      try {
        current = JSON.parse(current);
        continue;
      } catch (_) {
        return null;
      }
    }
    if (!current || typeof current !== "object") {
      return null;
    }
    if (current.nuvioPreview === ACTION_VERSION && current.kind) {
      return current;
    }
    if (current.values != null) {
      current = current.values;
      continue;
    }
    if (current.PAYLOAD != null) {
      current = current.PAYLOAD;
      continue;
    }
    return null;
  }
  return null;
}

export function extractSmartHubPreviewAction(requestedAppControl = null) {
  const data = requestedAppControl?.appControl?.data;
  if (!Array.isArray(data)) {
    return null;
  }
  const payloadEntry = data.find((entry) => String(entry?.key || "").toUpperCase() === "PAYLOAD");
  if (!payloadEntry) {
    return null;
  }
  return parseJsonValue(payloadEntry.value);
}
