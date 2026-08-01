const MAX_PREVIEW_TILES = 40;
const ACTION_VERSION = 1;

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

function addVisibleSectionLabel(tile, sectionTitle) {
  if (!tile) {
    return null;
  }
  const label = firstNonEmpty(sectionTitle);
  const itemTitle = firstNonEmpty(tile.title);
  if (!label || !itemTitle) {
    return tile;
  }
  return {
    ...tile,
    title: `${label} · ${itemTitle}`
  };
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

function buildContinueWatchingTile(item = {}, position = 0) {
  const meta = item.enrichedMeta && typeof item.enrichedMeta === "object" ? item.enrichedMeta : {};
  const merged = { ...item, ...meta };
  const itemId = firstNonEmpty(item.contentId, meta.id, item.id);
  const itemType = isSeriesType(item.contentType || meta.type) ? "series" : "movie";
  const image = resolvePreviewImage(merged);
  if (!itemId || !image) {
    return null;
  }
  const progressPercent = numberOrNull(item.progressPercent);
  const episodeSubtitle = formatEpisodeSubtitle(item);
  const subtitleParts = [];
  if (episodeSubtitle) {
    subtitleParts.push(episodeSubtitle);
  }
  if (progressPercent != null) {
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
    position
  };
}

function buildCatalogTile(item = {}, position = 0, sectionKey = "catalog") {
  const itemId = firstNonEmpty(item.id, item.contentId);
  const itemType = isSeriesType(item.type || item.apiType) ? "series" : "movie";
  const image = resolvePreviewImage(item);
  if (!itemId || !image) {
    return null;
  }
  return {
    title: firstNonEmpty(item.name, item.title, itemId),
    subtitle: itemType === "series" ? "Serie" : "Película",
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
    .map((tile) => addVisibleSectionLabel(tile, continueSectionTitle))
    .filter(Boolean)
    .slice(0, Math.max(0, Number(continueWatchingLimit || 0)));
  if (continueTiles.length) {
    sections.push({
      title: continueSectionTitle,
      title_display_mode: "AlwaysOn",
      position: 0,
      tiles: continueTiles
    });
  }

  (Array.isArray(catalogSections) ? catalogSections : []).forEach((section, sectionIndex) => {
    const sectionTitle = firstNonEmpty(section.title, "Xperience");
    const tiles = (Array.isArray(section.items) ? section.items : [])
      .map((item, index) => buildCatalogTile(item, index, firstNonEmpty(section.key, sectionTitle)))
      .map((tile) => addVisibleSectionLabel(tile, sectionTitle))
      .filter(Boolean)
      .slice(0, Math.max(0, Number(section.limit || section.items.length || 0)));
    if (tiles.length) {
      sections.push({
        title: sectionTitle,
        title_display_mode: "AlwaysOn",
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
      .map((tile) => addVisibleSectionLabel(tile, sectionTitle))
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
