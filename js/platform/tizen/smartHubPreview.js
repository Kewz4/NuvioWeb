import { Platform } from "../index.js";
import { Router } from "../../ui/navigation/router.js";
import { addonRepository } from "../../data/repository/addonRepository.js";
import { catalogRepository } from "../../data/repository/catalogRepository.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { CollectionsStore } from "../../data/local/collectionsStore.js";
import { SMART_HUB_PREVIEW_CONFIG } from "./smartHubPreviewConfig.js";
import {
  buildSmartHubPreviewPayload,
  extractSmartHubPreviewAction
} from "./smartHubPreviewData.js";
import {
  SMART_HUB_CARD_BADGES,
  buildCardArtworkUrl,
  ingestCardArtwork
} from "./smartHubCardArtwork.js";
import { getCachedArtworkUuid, setCachedArtworkUuid } from "./smartHubCardArtworkCache.js";

const PREVIEW_OPERATION = "http://tizen.org/appcontrol/operation/pick";
const WEB_SERVICE_FEATURE = "http://tizen.org/feature/web.service";
const PREVIEW_APP_CONTROL_DATA_KEY = "previewData";
const PREVIEW_APP_CONTROL_CHUNK_SIZE = 4096;
const PREVIEW_SNAPSHOT_FILE = "smart-hub-preview.pending.json";
const PRIVATE_STORAGE_ROOT = "wgt-private";
const BLOCKING_ROUTES = new Set(["", "authQrSignIn", "authSignIn", "syncCode", "profileSelection"]);

let initialized = false;
let profileReady = false;
let refreshTimer = null;
let refreshInFlight = null;
let pendingAction = null;
let pendingActionTimer = null;
let pendingActionAttempts = 0;

function getTizenApi() {
  return globalThis.tizen || null;
}

function getTizenRealModel() {
  try {
    return String(globalThis.webapis?.productinfo?.getRealModel?.() || "").trim();
  } catch (_) {
    return "";
  }
}

function allowsFalsePreviewCapability() {
  if (globalThis.__NUVIO_TIZEN_PREVIEW_ALLOW_FALSE_CAPABILITY__ === true) {
    return true;
  }
  return /AU8000/i.test(getTizenRealModel());
}

function isPersonalPreviewSupported() {
  if (!Platform.isTizen()) {
    return false;
  }
  const tizen = getTizenApi();
  if (!tizen?.application || typeof tizen.ApplicationControl !== "function") {
    return false;
  }
  try {
    const capability = tizen.systeminfo?.getCapability?.(WEB_SERVICE_FEATURE);
    if (capability === false) {
      if (!allowsFalsePreviewCapability()) {
        console.warn("[SmartHubPreview] Web service capability is unavailable");
        return false;
      }
      // The Tizen 6.5 emulator and some retail AU8000 firmware builds expose
      // the service successfully while reporting this capability as false.
      console.warn("[SmartHubPreview] Using the supported-device capability override");
    }
  } catch (_) {
    // Older supported TVs can omit the capability lookup but still expose services.
  }
  return true;
}

function serializePreviewData(previewData) {
  try {
    return JSON.stringify(previewData);
  } catch (error) {
    console.warn("[SmartHubPreview] Snapshot serialization failed", error);
    return "";
  }
}

function chunkPreviewData(serializedPreviewData) {
  const chunks = [];
  for (
    let offset = 0;
    offset < serializedPreviewData.length;
    offset += PREVIEW_APP_CONTROL_CHUNK_SIZE
  ) {
    chunks.push(serializedPreviewData.slice(offset, offset + PREVIEW_APP_CONTROL_CHUNK_SIZE));
  }
  return chunks;
}

function writePreviewSnapshot(previewData) {
  const tizen = getTizenApi();
  if (!tizen?.filesystem || !previewData?.sections?.length) {
    return Promise.resolve(false);
  }
  const contents = serializePreviewData(previewData);
  if (!contents) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    tizen.filesystem.resolve(
      PRIVATE_STORAGE_ROOT,
      (dir) => {
        let file;
        try {
          file = dir.resolve(PREVIEW_SNAPSHOT_FILE);
        } catch (_) {
          try {
            file = dir.createFile(PREVIEW_SNAPSHOT_FILE);
          } catch (error) {
            console.warn("[SmartHubPreview] Snapshot file creation failed", error);
            resolve(false);
            return;
          }
        }
        file.openStream(
          "w",
          (stream) => {
            try {
              stream.write(contents);
              stream.close();
              resolve(true);
            } catch (error) {
              try {
                stream.close();
              } catch (_) {}
              console.warn("[SmartHubPreview] Snapshot write failed", error);
              resolve(false);
            }
          },
          (error) => {
            console.warn("[SmartHubPreview] Snapshot stream failed", error);
            resolve(false);
          }
        );
      },
      (error) => {
        console.warn("[SmartHubPreview] Private storage resolve failed", error);
        resolve(false);
      },
      "rw"
    );
  });
}

function manifestBaseUrl() {
  return SMART_HUB_PREVIEW_CONFIG.manifestUrl.replace(/\/manifest\.json(?:[?#].*)?$/i, "");
}

async function loadXperienceCatalogSections(addon) {
  const baseUrl = addon?.baseUrl || manifestBaseUrl();
  const rows = await Promise.all(
    SMART_HUB_PREVIEW_CONFIG.catalogSections.map(async (section) => {
      const result = await catalogRepository.getCatalog({
        addonBaseUrl: baseUrl,
        addonId: SMART_HUB_PREVIEW_CONFIG.addonId,
        addonName: SMART_HUB_PREVIEW_CONFIG.addonName,
        catalogId: section.catalogId,
        catalogName: section.title,
        type: section.type,
        skip: 0,
        supportsSkip: true
      });
      return {
        ...section,
        items: result?.status === "success" ? result.data?.items || [] : []
      };
    })
  );
  return rows;
}

async function buildPreviewData() {
  const [continueWatching, manifestResult] = await Promise.all([
    watchProgressRepository
      .getRecent(SMART_HUB_PREVIEW_CONFIG.continueWatchingCandidateLimit)
      .catch((error) => {
        console.warn("[SmartHubPreview] Continue Watching load failed", error);
        return [];
      }),
    addonRepository
      .fetchAddon(SMART_HUB_PREVIEW_CONFIG.manifestUrl, {
        preferCache: true
      })
      .catch((error) => {
        console.warn("[SmartHubPreview] Xperience manifest load failed", error);
        return null;
      })
  ]);
  const addon =
    manifestResult?.status === "success"
      ? manifestResult.data
      : {
          id: SMART_HUB_PREVIEW_CONFIG.addonId,
          name: SMART_HUB_PREVIEW_CONFIG.addonName,
          baseUrl: manifestBaseUrl()
        };
  const catalogSections = await loadXperienceCatalogSections(addon).catch((error) => {
    console.warn("[SmartHubPreview] Xperience catalogs load failed", error);
    return [];
  });
  const payload = buildSmartHubPreviewPayload({
    continueWatching,
    continueWatchingLimit: SMART_HUB_PREVIEW_CONFIG.continueWatchingLimit,
    catalogSections,
    folderSections: SMART_HUB_PREVIEW_CONFIG.folderSections,
    addon: {
      id: addon.id || SMART_HUB_PREVIEW_CONFIG.addonId,
      name: addon.displayName || addon.name || SMART_HUB_PREVIEW_CONFIG.addonName,
      baseUrl: addon.baseUrl || manifestBaseUrl()
    }
  });
  return applyCardArtwork(payload);
}

/** Which overlay a section's tiles get, or null to leave the artwork plain. */
function badgeForSection(section = {}) {
  const key = String(section.badgeKey || "");
  return SMART_HUB_CARD_BADGES[key] || null;
}

// Compositing is a nicety; the preview is the point. A cold cache with forty
// tiles would otherwise serialise forty ingests behind the refresh, so the whole
// pass runs against a deadline and a few at a time. Whatever is not ready by
// then keeps its plain poster and is picked up by the next refresh, since every
// success is cached.
const CARD_ARTWORK_DEADLINE_MS = 20000;
const CARD_ARTWORK_CONCURRENCY = 4;

/**
 * Swaps each tile's plain poster for a composited card.
 *
 * Best effort throughout: a tile whose poster cannot be ingested in time keeps
 * the poster it already had. A preview with plain artwork is still a working
 * preview, so nothing here is allowed to fail or delay the refresh.
 */
async function applyCardArtwork(payload) {
  const publicKey = String(globalThis.__NUVIO_ENV__?.UPLOADCARE_PUBLIC_KEY || "").trim();
  if (!publicKey || !payload?.sections?.length) {
    return payload;
  }

  // Collection tiles already use artwork we designed; only media tiles, whose
  // posters arrive from a metadata provider, need a reason drawn onto them.
  const jobs = [];
  payload.sections.forEach((section) => {
    const badge = badgeForSection(section);
    if (!badge) {
      return;
    }
    section.tiles.forEach((tile) => {
      if (String(tile.image_url || "")) {
        jobs.push({ tile, badge });
      }
    });
  });

  const compose = ({ tile, badge }, uuid) => {
    const composed = buildCardArtworkUrl({
      artworkUuid: uuid,
      badge,
      progressPercent: tile.resume_progress_percent ?? null
    });
    if (composed) {
      tile.image_url = composed;
      // Composited cards are always 16:9, whatever the source poster was.
      tile.image_ratio = "16by9";
    }
  };

  // Anything already ingested is free, so apply those before spending time.
  const pending = [];
  jobs.forEach((job) => {
    const cached = getCachedArtworkUuid(job.tile.image_url);
    if (cached) {
      compose(job, cached);
    } else {
      pending.push(job);
    }
  });

  const deadline = Date.now() + CARD_ARTWORK_DEADLINE_MS;
  let next = 0;
  const worker = async () => {
    while (next < pending.length && Date.now() < deadline) {
      const job = pending[next];
      next += 1;
      const source = String(job.tile.image_url || "");
      const uuid = await ingestCardArtwork(source, { publicKey });
      if (uuid) {
        setCachedArtworkUuid(source, uuid);
        compose(job, uuid);
      }
    }
  };
  if (pending.length) {
    await Promise.all(
      Array.from({ length: Math.min(CARD_ARTWORK_CONCURRENCY, pending.length) }, () => worker())
    );
  }

  // Samsung's tile schema has no field for this; it existed only for the
  // compositor, so it must not reach the preview service.
  payload.sections.forEach((section) =>
    section.tiles.forEach((tile) => delete tile.resume_progress_percent)
  );
  return payload;
}

async function launchPreviewService(previewData) {
  const tizen = getTizenApi();
  const serviceId = String(
    globalThis.__NUVIO_TIZEN_PREVIEW_SERVICE_ID__ || "NuvioTV001.SmartHubPreviewService"
  ).trim();
  if (!serviceId || !previewData?.sections?.length) {
    return false;
  }
  const serializedPreviewData = serializePreviewData(previewData);
  if (!serializedPreviewData) {
    return false;
  }
  const snapshotWritten = await writePreviewSnapshot(previewData);
  if (!snapshotWritten) {
    console.warn("[SmartHubPreview] Shared snapshot unavailable; using AppControl payload");
  }
  return new Promise((resolve) => {
    try {
      const data = [
        new tizen.ApplicationControlData("caller", ["ForegroundApp"]),
        new tizen.ApplicationControlData(
          PREVIEW_APP_CONTROL_DATA_KEY,
          chunkPreviewData(serializedPreviewData)
        )
      ];
      const appControl = new tizen.ApplicationControl(
        PREVIEW_OPERATION,
        null,
        "image/jpeg",
        null,
        data
      );
      tizen.application.launchAppControl(
        appControl,
        serviceId,
        () => resolve(true),
        (error) => {
          console.warn("[SmartHubPreview] Service launch failed", error);
          resolve(false);
        }
      );
    } catch (error) {
      console.warn("[SmartHubPreview] Service launch threw", error);
      resolve(false);
    }
  });
}

async function refreshNow() {
  if (!profileReady || !isPersonalPreviewSupported()) {
    return false;
  }
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = buildPreviewData()
    .then((previewData) => launchPreviewService(previewData))
    .catch((error) => {
      console.warn("[SmartHubPreview] Refresh failed", error);
      return false;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

function scheduleRefresh(delayMs = SMART_HUB_PREVIEW_CONFIG.refreshDebounceMs) {
  if (!profileReady || !isPersonalPreviewSupported()) {
    return;
  }
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(
    () => {
      refreshTimer = null;
      void refreshNow();
    },
    Math.max(0, Number(delayMs || 0))
  );
}

function collectionFolderExists(collectionId, folderId) {
  return CollectionsStore.get().some(
    (collection) =>
      String(collection.id) === String(collectionId) &&
      (collection.folders || []).some((folder) => String(folder.id) === String(folderId))
  );
}

async function navigateFromPreviewAction(action) {
  if (action.kind === "collection-folder") {
    if (collectionFolderExists(action.collectionId, action.folderId)) {
      await Router.navigate("folderDetail", {
        collectionId: action.collectionId,
        folderId: action.folderId,
        collectionTitle: action.collectionTitle || ""
      });
      return true;
    }
    const fallback = action.fallbackCatalog || {};
    if (fallback.catalogId) {
      await Router.navigate("catalogSeeAll", {
        addonBaseUrl: fallback.addonBaseUrl || manifestBaseUrl(),
        addonId: fallback.addonId || SMART_HUB_PREVIEW_CONFIG.addonId,
        addonName: fallback.addonName || SMART_HUB_PREVIEW_CONFIG.addonName,
        catalogId: fallback.catalogId,
        catalogName: fallback.catalogName || action.title || "",
        type: fallback.type || "movie",
        initialItems: []
      });
      return true;
    }
    return false;
  }
  if (action.kind !== "media" || !action.itemId) {
    return false;
  }
  const continueWatching = action.source === "continue-watching";
  await Router.navigate("detail", {
    itemId: action.itemId,
    itemType: action.itemType || "movie",
    imdbId: action.imdbId || null,
    tmdbId: action.tmdbId || null,
    traktId: action.traktId || null,
    fallbackTitle: action.title || action.itemId,
    fromSmartHubPreview: true,
    returnHomeOnBack: true,
    autoOpenContinueWatching: continueWatching,
    resumeProgressMs: continueWatching ? Number(action.resumePositionMs || 0) || 0 : 0,
    resumeProgressPercent: continueWatching ? (action.resumeProgressPercent ?? null) : null,
    resumeDurationMs: continueWatching ? Number(action.resumeDurationMs || 0) || 0 : 0,
    resumeVideoId: continueWatching ? action.resumeVideoId || null : null,
    resumeSeason: continueWatching ? (action.resumeSeason ?? null) : null,
    resumeEpisode: continueWatching ? (action.resumeEpisode ?? null) : null,
    resumeStreamIdentity: continueWatching ? action.resumeStreamIdentity || null : null
  });
  return true;
}

function clearPendingActionTimer() {
  if (pendingActionTimer) {
    clearTimeout(pendingActionTimer);
    pendingActionTimer = null;
  }
}

function flushPendingAction() {
  clearPendingActionTimer();
  if (!pendingAction) {
    return;
  }
  const currentRoute = String(Router.getCurrent?.() || "");
  if (!profileReady || BLOCKING_ROUTES.has(currentRoute)) {
    pendingActionAttempts += 1;
    if (pendingActionAttempts < 240) {
      pendingActionTimer = setTimeout(flushPendingAction, 500);
    }
    return;
  }
  const action = pendingAction;
  pendingAction = null;
  pendingActionAttempts = 0;
  void navigateFromPreviewAction(action).catch((error) => {
    console.warn("[SmartHubPreview] Deep link navigation failed", error);
  });
}

function queueRequestedAppControl(requestedAppControl) {
  const action = extractSmartHubPreviewAction(requestedAppControl);
  if (!action) {
    return false;
  }
  pendingAction = action;
  pendingActionAttempts = 0;
  flushPendingAction();
  return true;
}

function readColdLaunchAction() {
  try {
    const requested = getTizenApi()
      ?.application?.getCurrentApplication?.()
      ?.getRequestedAppControl?.();
    queueRequestedAppControl(requested);
  } catch (error) {
    console.warn("[SmartHubPreview] Cold-launch action read failed", error);
  }
}

function handleAppControlEvent() {
  readColdLaunchAction();
}

function init() {
  if (initialized || !isPersonalPreviewSupported()) {
    return;
  }
  initialized = true;
  globalThis.addEventListener?.("appcontrol", handleAppControlEvent);
  globalThis.document?.addEventListener?.("nuvio:profile-ready", () => {
    profileReady = true;
    flushPendingAction();
    scheduleRefresh(0);
  });
  globalThis.document?.addEventListener?.("nuvio:watch-progress-changed", () => {
    scheduleRefresh();
  });
  readColdLaunchAction();
}

function notifyProfileReady() {
  profileReady = true;
  flushPendingAction();
  scheduleRefresh(0);
}

export const SmartHubPreview = {
  init,
  notifyProfileReady,
  refresh: refreshNow,
  scheduleRefresh
};
