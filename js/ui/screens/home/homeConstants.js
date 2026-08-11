import {
  WATCH_PROGRESS_COMPLETED_THRESHOLD,
  WATCH_PROGRESS_STARTED_THRESHOLD
} from "../../../domain/model/watchProgress.js";

export const HERO_ROTATE_FIRST_DELAY_MS = 20000;
export const HERO_ROTATE_INTERVAL_MS = 10000;
export const HOME_LAYOUT_SEQUENCE = ["modern", "grid", "classic"];

export const CW_MAX_NEXT_UP_LOOKUPS = 32;
export const CW_MAX_NEXT_UP_CONCURRENCY = 4;
export const CW_MAX_ENRICHMENT_CONCURRENCY = 4;
export const CW_MAX_VISIBLE_ITEMS = 300;
export const CW_DISPLAY_SNAPSHOT_MAX_ITEMS = 50;
export const CW_INITIAL_RESOLVE_BUDGET_MS = 1000;
export const CW_RENDER_BATCH_ITEMS_DEFAULT = 30;
export const CW_RENDER_BATCH_ITEMS_CONSTRAINED = 18;
export const CW_RENDER_BATCH_ITEMS_LEGACY_TV = 12;
export const CW_RENDER_LOAD_AHEAD_ITEMS = 4;
export const CW_DAYS_CAP = 60;
export const CW_PROGRESS_START_THRESHOLD = WATCH_PROGRESS_STARTED_THRESHOLD;
export const CW_PROGRESS_END_THRESHOLD = WATCH_PROGRESS_COMPLETED_THRESHOLD;
export const CW_ENTER_DELAY_MS = 320;
export const CW_HOLD_DELAY_MS = 650;
export const CW_META_TIMEOUT_MS = 1800;
export const CW_META_TIMEOUT_TV_MS = 4200;
export const CW_NEXT_UP_META_TIMEOUT_MS = 2200;
export const CW_ENRICHMENT_CACHE_KEY = "homeContinueWatchingEnrichmentCache";
export const CW_DISPLAY_SNAPSHOT_KEY = "homeContinueWatchingDisplaySnapshot";
export const CW_DISPLAY_SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const CW_DISPLAY_SNAPSHOT_MAX_SCOPES = 4;
export const CW_ENRICHMENT_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const CW_NEXT_UP_NEW_SEASON_UNAIRED_WINDOW_DAYS = 7;

export const HOME_INITIAL_CATALOG_LOAD = 10;
export const HOME_MAX_ITEMS_PER_ROW_DEFAULT = 15;
export const HOME_MAX_ITEMS_PER_ROW_CONSTRAINED = 10;
export const HOME_MAX_ITEMS_PER_ROW_LEGACY_TV = 8;
export const HOME_LOADING_ROW_ITEMS_DEFAULT = 10;
export const HOME_LOADING_ROW_ITEMS_CONSTRAINED = 8;
export const HOME_LOADING_ROW_ITEMS_LEGACY_TV = 6;
export const HOME_ROW_TIMEOUT_MS = 3500;
export const HOME_ROW_RETRY_TIMEOUT_MS = 12000;
export const HOME_BACKGROUND_RENDER_DELAY_MS = 120;
export const HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS = 180;
export const HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS = 400;
export const HOME_RETURN_FOCUS_STATE_KEY = "homeReturnFocusState";
export const HOME_PERF_DEBUG = Boolean(globalThis.__NUVIO_DEBUG_HOME_PERF__);

// Releasing posters that have scrolled well out of the way.
//
// Deliberately far outside the hydration margins (720/520 on a TV) so the two
// passes never argue over the same image — releasing anything near the edge
// would drop and refetch the same poster as focus moves along a row.
export const HOME_IMAGE_RELEASE_MARGIN_Y = 2200;
export const HOME_IMAGE_RELEASE_MARGIN_X = 1600;

// How many rows either side of the focused one are built in full. Ahead is
// larger than behind because movement down is what has to feel instant; a row
// already passed can be refilled on the way back.
export const HOME_ROW_WINDOW_AHEAD = 3;
export const HOME_ROW_WINDOW_BEHIND = 2;

// Rows filled per idle slice. Small enough that a slice stays inside a frame on
// a TV, large enough that the list finishes filling in well under a second.
export const HOME_ROW_MATERIALISE_BATCH = 2;
