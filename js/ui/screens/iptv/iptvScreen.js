import { ScreenUtils } from "../../navigation/screen.js";
import { Router } from "../../navigation/router.js";
import { I18n } from "../../../i18n/index.js";
import { escapeHtml } from "../home/homeUtils.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { Environment } from "../../../platform/environment.js";
import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  focusWithoutAutoScroll,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  renderRootSidebar
} from "../../components/sidebarNavigation.js";
import { IptvSettingsStore } from "../../../data/local/iptvSettingsStore.js";
import {
  getDeadChannelIds,
  markChannelAlive,
  markChannelsDead,
  recordChannelMiss
} from "../../../data/local/iptvChannelHealthStore.js";
import {
  loadIptvSnapshot,
  loadChannelNowNext,
  loadSharedGuideData
} from "../../../data/repository/iptvRepository.js";
import { programmeProgress } from "../../../core/iptv/epgIndex.js";
import { categoryLabelKey } from "../../../core/iptv/channelCategories.js";
import { CHANNEL_ALIVE, CHANNEL_DEAD, probeChannels } from "../../../core/iptv/channelHealth.js";
import { iptvRequestHeaders } from "../../../core/iptv/xtreamClient.js";
import { createVirtualKeyboard } from "../../components/virtualKeyboard.js";

const FAVORITES_GROUP_KEY = "__favorites__";
const SEARCH_GROUP_KEY = "__search__";

// Row identity lives in `data-row`, NOT `data-index`: ScreenUtils.indexFocusables
// renumbers `data-index` on every `.focusable` in the container by global focus
// order, so the sidebar's buttons shift every row here by six. Zone lookups keyed
// on `data-index` therefore resolved to the wrong element (or none), which is
// what made the remote feel unresponsive in this tab.

// Navigation zones. Left/Right move between them, Up/Down move inside one.
const ZONE_SIDEBAR = "sidebar";
const ZONE_GROUPS = "groups";
const ZONE_CHANNELS = "channels";

// How many channel rows exist at a time. Chosen so a group switch stays well
// under a frame budget on 2021-era TV hardware.
const CHANNEL_RENDER_STEP = 50;
// Grow the window this far before focus reaches its end, so scrolling down a
// long category never stalls on a "show more" step.
const CHANNEL_PREFETCH_ROWS = 12;

// Rows of breathing room kept above and below the highlight while scrolling, so
// the viewer can see where the list is going instead of riding its edge.
const SCROLL_CONTEXT_ROWS = 2;

// Rows around the highlight are probed first and fast, so the viewer never
// reaches a dead row before it is checked.
const HEALTH_PROBE_LOOKAHEAD = 24;
// The rest of the category is then swept in the background at a gentler rate.
// Checking only a window meant a dead channel forty rows down survived until
// someone scrolled onto it; sweeping the whole category means the list settles
// to only working channels while it is being browsed.
// How long the channel list waits after the category highlight stops moving.
const CHANNEL_RAIL_REPAINT_DELAY_MS = 180;

const HEALTH_SWEEP_BATCH = 40;
const HEALTH_SWEEP_CONCURRENCY = 3;

/**
 * Holds an index inside [0, count).
 *
 * Deliberately clamps rather than wraps. A wrapping list has no top and no
 * bottom: holding Down runs forever and the viewer cannot tell whether they
 * have seen everything, which is exactly the "infinite scrolling" complaint the
 * category rail drew.
 */
function clampIndex(index, count) {
  if (!count) {
    return 0;
  }
  return Math.max(0, Math.min(count - 1, index));
}

function t(key, params = {}, fallback = "") {
  return I18n.t(key, params, { fallback: fallback || key });
}

/**
 * Localized name for a canonical category.
 *
 * An Xtream panel supplies its own category names, which are already in the
 * provider's language and have no translation key; those fall through unchanged.
 */
function categoryLabel(category = "") {
  const key = categoryLabelKey(category);
  const label = I18n.t(key, {}, { fallback: "" });
  return label && label !== key ? label : category;
}

/** Comparison form for search: accent-free, punctuation-free lowercase. */
function normalizeSearchText(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function formatClock(ms) {
  try {
    return new Date(Number(ms)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return "";
  }
}

export const IptvScreen = {
  async mount() {
    this.container = document.getElementById("iptv");
    ScreenUtils.show(this.container);

    this.settings = IptvSettingsStore.get();
    this.layoutPrefs = LayoutPreferences.get();
    this.sidebarProfile = await getSidebarProfileState();
    this.sidebarExpanded = false;
    this.snapshot = null;
    this.loading = true;
    this.loadError = "";
    this.selectedGroupKey = this.settings.favoriteChannelIds.length ? FAVORITES_GROUP_KEY : null;
    this.channelRenderLimit = CHANNEL_RENDER_STEP;
    this.focusZone = ZONE_GROUPS;
    this.groupIndex = 0;
    this.channelIndex = 0;
    this.groupEntries = [];
    this.channelRowCount = 0;
    this.onDemandGuide = new Map();
    this.searchQuery = "";
    this.keyboard = null;
    this.channelRailTimer = null;
    this.probedChannelIds = new Set();
    this.probeInFlight = false;
    this.guideSweepStarted = false;
    this.mountToken = Number(this.mountToken || 0) + 1;

    this.render();
    this.bindEvents();

    if (!this.settings.playlists.length) {
      this.loading = false;
      this.render();
      return;
    }

    await this.loadChannels();
  },

  async loadChannels({ forceRefresh = false } = {}) {
    const token = this.mountToken;
    this.loading = true;
    this.loadError = "";
    this.render();

    try {
      const snapshot = await loadIptvSnapshot(this.settings, {
        forceRefresh,
        // Channels proven dead on a previous visit never come back into the
        // list until their record expires.
        excludeChannelIds: getDeadChannelIds()
      });
      if (token !== this.mountToken || Router.getCurrent() !== "iptv") {
        return;
      }
      this.snapshot = snapshot;
      this.probedChannelIds = new Set();
      this.guideSweepStarted = false;
      if (!this.selectedGroupKey || !this.groupExists(this.selectedGroupKey)) {
        this.selectedGroupKey = snapshot.favorites.length
          ? FAVORITES_GROUP_KEY
          : snapshot.groups[0]?.name || null;
      }
    } catch (error) {
      if (token !== this.mountToken) {
        return;
      }
      this.loadError = error?.message || t("iptv_playlist_error");
    } finally {
      if (token === this.mountToken) {
        this.loading = false;
        this.render();
        this.startGuideSweep();
        this.probeVisibleChannels();
      }
    }
  },

  isCurrentMount(token) {
    return token === this.mountToken && Router.getCurrent() === "iptv";
  },

  /* Guide ---------------------------------------------------------------- */

  /**
   * Fills in now/next from the shared community guides.
   *
   * Deliberately after first paint and never awaited: the guides total tens of
   * megabytes, and a viewer must never wait on a programme title to see their
   * channels. Each feed that lands re-renders the guide lines in place.
   */
  startGuideSweep() {
    if (this.guideSweepStarted || !this.snapshot?.channels?.length) {
      return;
    }
    this.guideSweepStarted = true;
    const token = this.mountToken;
    const missing = this.snapshot.channels.filter((channel) => !this.snapshot.nowNext[channel.id]);
    if (!missing.length) {
      return;
    }

    void loadSharedGuideData(missing, {
      userAgent: this.settings.userAgent,
      shouldStop: () => !this.isCurrentMount(token),
      onPartial: (chunk) => {
        if (!this.isCurrentMount(token) || !this.snapshot) {
          return;
        }
        Object.assign(this.snapshot.nowNext, chunk);
        this.refreshVisibleGuideLines();
      }
    }).catch(() => {
      // The channel list stands on its own; a guide host being down is not an
      // error the viewer needs to see.
    });
  },

  /** Rewrites just the guide lines of the rows already on screen. */
  refreshVisibleGuideLines() {
    if (!this.container) {
      return;
    }
    const channels = this.visibleChannels();
    this.container.querySelectorAll(".iptv-channel[data-row]").forEach((node) => {
      const channel = channels[Number(node.dataset.row)];
      const holder = channel && node.querySelector(".iptv-channel-guide");
      if (!holder) {
        return;
      }
      const replacement = document.createElement("div");
      replacement.innerHTML = this.renderNowNext(channel);
      const next = replacement.firstElementChild;
      if (next) {
        holder.replaceWith(next);
      }
    });
  },

  /* Channel health -------------------------------------------------------- */

  /**
   * Probes the rows around the highlight and drops the dead ones.
   *
   * Runs as the viewer scrolls rather than as one sweep at load: a category can
   * hold a thousand channels, and probing them all would leave the tab blank for
   * minutes to spare the viewer a handful of failed selections.
   */
  probeVisibleChannels() {
    if (this.probeInFlight || !this.snapshot) {
      return;
    }
    const channels = this.visibleChannels();
    if (!channels.length) {
      return;
    }
    const from = Math.max(0, this.channelIndex - SCROLL_CONTEXT_ROWS);
    const unprobed = (list) => list.filter((c) => c && !this.probedChannelIds.has(c.id));
    // What the viewer is about to reach takes priority; whatever is left of the
    // category is swept behind it so the whole list ends up verified.
    let candidates = unprobed(channels.slice(from, from + HEALTH_PROBE_LOOKAHEAD));
    let background = false;
    if (!candidates.length) {
      candidates = unprobed(channels).slice(0, HEALTH_SWEEP_BATCH);
      background = true;
    }
    if (!candidates.length) {
      return;
    }

    const token = this.mountToken;
    this.probeInFlight = true;
    candidates.forEach((channel) => this.probedChannelIds.add(channel.id));
    const dead = [];

    void probeChannels(candidates, {
      headers: iptvRequestHeaders(this.settings.userAgent),
      // The background sweep runs slower on purpose: it must never compete with
      // the rows the viewer is actually moving through.
      concurrency: background ? HEALTH_SWEEP_CONCURRENCY : undefined,
      shouldStop: () => !this.isCurrentMount(token),
      onResult: ({ channel, state }) => {
        if (state === CHANNEL_DEAD) {
          dead.push(channel.id);
          return;
        }
        if (state === CHANNEL_ALIVE) {
          // Answering clears any strikes the channel had accumulated.
          markChannelAlive(channel.id);
          return;
        }
        // Unknown: a timeout is also what congestion looks like, so it takes a
        // few consecutive misses before a channel is written off.
        if (recordChannelMiss(channel.id)) {
          dead.push(channel.id);
        }
      }
    })
      .then(() => {
        if (!this.isCurrentMount(token)) {
          return;
        }
        if (dead.length) {
          markChannelsDead(dead);
          this.removeChannels(dead);
        }
      })
      .finally(() => {
        this.probeInFlight = false;
        // A sweep can finish after the highlight has already moved past the
        // window it covered, so immediately check what is on screen now.
        if (this.isCurrentMount(token)) {
          this.probeVisibleChannels();
        }
      });
  },

  /** Removes channels from the snapshot in place and repaints. */
  removeChannels(channelIds = []) {
    const removed = new Set(channelIds);
    if (!removed.size || !this.snapshot) {
      return;
    }
    const keep = (list) => (list || []).filter((channel) => !removed.has(channel.id));
    this.snapshot.channels = keep(this.snapshot.channels);
    this.snapshot.favorites = keep(this.snapshot.favorites);
    this.snapshot.groups = this.snapshot.groups
      .map((group) => ({ ...group, channels: keep(group.channels) }))
      .filter((group) => group.channels.length);

    if (!this.groupExists(this.selectedGroupKey)) {
      this.selectedGroupKey = this.snapshot.groups[0]?.name || null;
      this.channelIndex = 0;
    }
    // Keep the highlight inside the shortened list rather than letting it point
    // past the end.
    this.channelIndex = Math.min(this.channelIndex, Math.max(0, this.visibleChannels().length - 1));
    this.render();
  },

  groupExists(key) {
    if (key === FAVORITES_GROUP_KEY) {
      return Boolean(this.snapshot?.favorites?.length);
    }
    return Boolean(this.snapshot?.groups?.some((group) => group.name === key));
  },

  /**
   * Channels matching the current search, across every category.
   *
   * Matching is on the normalized name so accents and the "(1080p)" suffix do
   * not have to be typed: someone looking for "Canción" finds it by typing
   * "cancion", which matters when the only keyboard is a remote.
   */
  searchResults() {
    const query = normalizeSearchText(this.searchQuery);
    if (!query || !this.snapshot) {
      return [];
    }
    return this.snapshot.channels.filter((channel) =>
      normalizeSearchText(channel.name).includes(query)
    );
  },

  visibleChannels() {
    if (!this.snapshot) {
      return [];
    }
    if (this.selectedGroupKey === SEARCH_GROUP_KEY) {
      return this.searchResults();
    }
    if (this.selectedGroupKey === FAVORITES_GROUP_KEY) {
      return this.snapshot.favorites;
    }
    return (
      this.snapshot.groups.find((group) => group.name === this.selectedGroupKey)?.channels || []
    );
  },

  renderSidebar() {
    return renderRootSidebar({
      selectedRoute: "iptv",
      profile: this.sidebarProfile,
      layout: this.layoutPrefs,
      expanded: Boolean(this.sidebarExpanded)
    });
  },

  renderEmptyState() {
    return `
      <section class="iptv-empty">
        <h2 class="iptv-empty-title">${escapeHtml(t("iptv_empty_title"))}</h2>
        <p class="iptv-empty-subtitle">${escapeHtml(t("iptv_empty_subtitle"))}</p>
        <button class="iptv-empty-action focusable" data-action="openSettings">
          ${escapeHtml(t("iptv_open_settings"))}
        </button>
      </section>
    `;
  },

  renderGroupRail() {
    const groups = this.snapshot?.groups || [];
    const favorites = this.snapshot?.favorites || [];
    const entries = [
      {
        key: SEARCH_GROUP_KEY,
        label: this.searchQuery
          ? t("iptv_search_active", { 1: this.searchQuery }, `Search: ${this.searchQuery}`)
          : t("iptv_search", {}, "Search channels"),
        count: this.searchQuery ? this.searchResults().length : ""
      },
      ...(favorites.length
        ? [{ key: FAVORITES_GROUP_KEY, label: t("iptv_favorites"), count: favorites.length }]
        : []),
      ...groups.map((group) => ({
        key: group.name,
        label: categoryLabel(group.name),
        count: group.channels.length
      }))
    ];

    this.groupEntries = entries;
    const zoneActive = this.focusZone === ZONE_GROUPS;

    return `
      <nav class="iptv-rail iptv-groups${zoneActive ? " zone-active" : ""}"
           aria-label="${escapeHtml(t("iptv_categories"))}">
        <div class="iptv-rail-heading">${escapeHtml(t("iptv_categories"))}</div>
        <div class="iptv-rail-scroll" data-scroll="${ZONE_GROUPS}">
        ${entries
          .map(
            (entry, index) => `
          <button class="iptv-group focusable${entry.key === this.selectedGroupKey ? " selected" : ""}${
            zoneActive && index === this.groupIndex ? " focused" : ""
          }"
                  data-action="selectGroup"
                  data-zone="${ZONE_GROUPS}"
                  data-row="${index}"
                  data-group="${escapeHtml(entry.key)}">
            <span class="iptv-group-label">${escapeHtml(entry.label)}</span>
            <span class="iptv-group-count">${entry.count}</span>
          </button>
        `
          )
          .join("")}
        </div>
      </nav>
    `;
  },

  renderNowNext(channel) {
    const guide =
      this.snapshot?.nowNext?.[channel.id] || this.onDemandGuide.get(channel.id) || null;
    if (!guide?.now && !guide?.next) {
      return `<div class="iptv-channel-guide muted">${escapeHtml(t("iptv_no_guide"))}</div>`;
    }
    const progress = guide.now ? Math.round(programmeProgress(guide.now) * 100) : 0;
    return `
      <div class="iptv-channel-guide">
        ${
          guide.now
            ? `<div class="iptv-now">
                 <span class="iptv-guide-label">${escapeHtml(t("iptv_now"))}</span>
                 <span class="iptv-guide-title">${escapeHtml(guide.now.title)}</span>
                 <span class="iptv-guide-progress"><i style="width:${progress}%"></i></span>
               </div>`
            : ""
        }
        ${
          guide.next
            ? `<div class="iptv-next">
                 <span class="iptv-guide-label">${escapeHtml(t("iptv_next"))}</span>
                 <span class="iptv-guide-title">${escapeHtml(guide.next.title)}</span>
                 <span class="iptv-guide-time">${escapeHtml(formatClock(guide.next.startMs))}</span>
               </div>`
            : ""
        }
      </div>
    `;
  },

  renderChannelGrid() {
    const channels = this.visibleChannels();
    if (!channels.length) {
      const emptyMessage =
        this.selectedGroupKey === SEARCH_GROUP_KEY && this.searchQuery
          ? t("iptv_search_empty", {}, "No channels match that search.")
          : t("iptv_no_channels");
      return `<section class="iptv-rail iptv-channels empty"><p>${escapeHtml(emptyMessage)}</p></section>`;
    }
    const favorites = new Set(this.settings.favoriteChannelIds);
    // Real provider categories run to hundreds of channels (iptv-org's Spanish
    // "General" group is ~1000). Rendering them all costs seconds of layout on
    // TV hardware, so only a window exists in the DOM; it grows as the
    // highlight approaches its end, which the viewer never sees happen.
    const limit = Number(this.channelRenderLimit || CHANNEL_RENDER_STEP);
    const visible = channels.slice(0, limit);
    const zoneActive = this.focusZone === ZONE_CHANNELS;
    // Down past the last rendered row is still a real channel when more exist,
    // so the row count is the full list, not the window.
    this.channelRowCount = channels.length;
    const groupName =
      this.selectedGroupKey === SEARCH_GROUP_KEY
        ? t("iptv_search_results", {}, "Search results")
        : this.selectedGroupKey === FAVORITES_GROUP_KEY
          ? t("iptv_favorites")
          : categoryLabel(this.selectedGroupKey);

    return `
      <section class="iptv-rail iptv-channels${zoneActive ? " zone-active" : ""}">
        <div class="iptv-rail-heading">
          ${escapeHtml(groupName || t("iptv_all_channels"))}
          <span class="iptv-rail-count">${escapeHtml(t("iptv_channel_count", { 1: channels.length }, `${channels.length} channels`))}</span>
        </div>
        <div class="iptv-rail-scroll" data-scroll="${ZONE_CHANNELS}">
        ${visible
          .map(
            (channel, index) => `
          <button class="iptv-channel focusable${zoneActive && index === this.channelIndex ? " focused" : ""}"
                  data-action="playChannel"
                  data-zone="${ZONE_CHANNELS}"
                  data-row="${index}"
                  data-channel-id="${escapeHtml(channel.id)}">
            <span class="iptv-channel-logo">
              ${
                channel.logo
                  ? `<img src="${escapeHtml(channel.logo)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'" />`
                  : `<span class="iptv-channel-initial">${escapeHtml(channel.name.charAt(0).toUpperCase())}</span>`
              }
            </span>
            <span class="iptv-channel-body">
              <span class="iptv-channel-name">
                ${favorites.has(channel.id) ? '<span class="iptv-fav-dot" aria-hidden="true">★</span>' : ""}
                ${escapeHtml(channel.name)}
              </span>
              ${this.renderNowNext(channel)}
            </span>
            ${channel.qualityLabel ? `<span class="iptv-channel-quality">${escapeHtml(channel.qualityLabel)}</span>` : ""}
          </button>
        `
          )
          .join("")}
        </div>
      </section>
    `;
  },

  renderContent() {
    if (!this.settings.playlists.length) {
      return this.renderEmptyState();
    }
    if (this.loading) {
      return `<section class="iptv-loading"><p>${escapeHtml(t("iptv_loading"))}</p></section>`;
    }
    if (this.loadError) {
      return `
        <section class="iptv-error">
          <p>${escapeHtml(this.loadError)}</p>
          <button class="iptv-empty-action focusable" data-action="refresh">
            ${escapeHtml(t("iptv_refresh"))}
          </button>
        </section>
      `;
    }
    return `
      <div class="iptv-body">
        ${this.renderGroupRail()}
        ${this.renderChannelGrid()}
      </div>
    `;
  },

  render() {
    if (!this.container) {
      return;
    }
    const warnings = this.snapshot?.warnings || [];
    // home-shell/home-main carry the sidebar rail tokens and the absolute
    // sidebar's left offset, so the Live TV tab lines up with every other tab.
    this.container.innerHTML = `
      <div class="home-shell iptv-shell">
        ${this.renderSidebar()}
        <main class="home-main iptv-main">
          <header class="iptv-header">
            <h1 class="iptv-title">${escapeHtml(t("iptv_title"))}</h1>

            <p class="iptv-hint">${escapeHtml(t("iptv_dpad_hint"))}</p>
            <div id="iptvKeyboard" class="iptv-keyboard"></div>
            ${
              this.snapshot?.guideOnDemand
                ? `<p class="iptv-note">${escapeHtml(t("iptv_guide_on_demand"))}</p>`
                : ""
            }
            ${warnings.length ? `<p class="iptv-note warning">${escapeHtml(warnings.join(" · "))}</p>` : ""}
          </header>
          ${this.renderContent()}
        </main>
      </div>
    `;
    ScreenUtils.indexFocusables(this.container);
    // Focus is driven by the zone model, not DOM order: setInitialFocus would
    // yank the highlight back to the first focusable on every re-render.
    this.syncDomFocusToZone();
    // render() replaces the container's HTML, which throws away the sidebar
    // nodes these listeners were attached to, so re-bind on every render.
    bindRootSidebarEvents(this.container, { currentRoute: "iptv" });
  },

  bindEvents() {
    if (!this.container || this.container.__iptvEventsBound) {
      return;
    }
    this.container.__iptvEventsBound = true;

    this.container.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-action]");
      if (!target) {
        return;
      }
      const action = target.dataset.action;
      if (action === "selectGroup") {
        this.selectGroup(target.dataset.group);
      } else if (action === "playChannel") {
        this.playChannel(target.dataset.channelId);
      } else if (action === "openSettings") {
        Router.navigate("settings", { section: "iptv" });
      } else if (action === "refresh") {
        this.loadChannels({ forceRefresh: true });
      } else {
        // Sidebar tabs (gotoHome, gotoSettings, ...). Delegated here so a
        // re-render can never leave the navigation dead.
        activateLegacySidebarAction(action, "iptv");
      }
    });
  },

  selectGroup(key) {
    if (!key || key === this.selectedGroupKey) {
      return;
    }
    if (this.channelRailTimer) {
      clearTimeout(this.channelRailTimer);
      this.channelRailTimer = null;
    }
    this.selectedGroupKey = key;
    this.channelRenderLimit = CHANNEL_RENDER_STEP;
    this.channelIndex = 0;
    this.render();
    this.probeVisibleChannels();
  },

  /**
   * Remote/D-pad handling.
   *
   * Uses an explicit zone model (sidebar | categories | channels) rather than
   * ScreenUtils' geometry-based focus. The sidebar is absolutely positioned and
   * overlaps the content box, so geometric "nearest neighbour" searches jumped
   * between the sidebar and the rails unpredictably. Left/Right move between
   * zones, Up/Down move within one, which is what a remote user expects.
   */
  async onKeyDown(event) {
    // While the keyboard is up it owns the remote entirely; the rails behind it
    // must not also move.
    if (this.keyboard) {
      const isBack = Environment.isBackEvent(event);
      if (this.keyboard.handleKeyDown(event, { isBack })) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        return;
      }
    }
    if (Environment.isBackEvent(event)) {
      event?.preventDefault?.();
      if (this.focusZone !== ZONE_SIDEBAR) {
        // Back walks out one zone at a time before leaving the tab.
        this.setZone(this.focusZone === ZONE_CHANNELS ? ZONE_GROUPS : ZONE_SIDEBAR);
        return;
      }
      Router.navigate("home");
      return;
    }

    const keyCode = Number(event?.keyCode || 0);
    const key = String(event?.key || "");
    const isUp = keyCode === 38 || key === "ArrowUp";
    const isDown = keyCode === 40 || key === "ArrowDown";
    const isLeft = keyCode === 37 || key === "ArrowLeft";
    const isRight = keyCode === 39 || key === "ArrowRight";
    const isEnter = keyCode === 13 || key === "Enter";
    const isPageUp = keyCode === 33 || key === "PageUp";
    const isPageDown = keyCode === 34 || key === "PageDown";

    // Context key toggles a favourite without leaving the list.
    if (key === "ContextMenu" || keyCode === 457) {
      if (this.focusZone === ZONE_CHANNELS) {
        const channel = this.visibleChannels()[this.channelIndex];
        if (channel) {
          event.preventDefault?.();
          this.toggleFavorite(channel.id);
          return;
        }
      }
    }

    if (this.focusZone === ZONE_SIDEBAR) {
      // Hand the sidebar back to the shared helper so tab order and the profile
      // button behave exactly as they do on every other screen.
      if (isRight) {
        event.preventDefault?.();
        this.setZone(this.hasGroups() ? ZONE_GROUPS : ZONE_CHANNELS);
        return;
      }
      ScreenUtils.handleDpadNavigation(
        event,
        this.container,
        ".home-sidebar .focusable, .modern-sidebar-panel .focusable"
      );
      return;
    }

    if (isLeft) {
      event.preventDefault?.();
      this.setZone(this.focusZone === ZONE_CHANNELS ? ZONE_GROUPS : ZONE_SIDEBAR);
      return;
    }

    if (isRight) {
      event.preventDefault?.();
      if (this.focusZone === ZONE_GROUPS && this.visibleChannels().length) {
        this.channelIndex = 0;
        this.setZone(ZONE_CHANNELS);
      }
      return;
    }

    if (isUp || isDown || isPageUp || isPageDown) {
      event.preventDefault?.();
      const page = isPageUp || isPageDown;
      const step = page ? 10 : 1;
      const delta = (isDown || isPageDown ? 1 : -1) * step;
      this.moveWithinZone(delta);
      return;
    }

    if (isEnter) {
      event.preventDefault?.();
      this.activateFocused();
    }
  },

  /**
   * Moves the highlight inside the active zone.
   *
   * Only the affected rail is repainted — a full re-render on every key press
   * costs hundreds of milliseconds on TV hardware with fifty logo images in the
   * list, which reads as the remote not responding.
   */
  moveWithinZone(delta) {
    if (this.focusZone === ZONE_GROUPS) {
      const count = (this.groupEntries || []).length;
      if (!count) {
        return;
      }
      const previousIndex = this.groupIndex;
      this.groupIndex = clampIndex(this.groupIndex + delta, count);
      this.updateFocusedRow(ZONE_GROUPS, previousIndex, this.groupIndex);

      // Moving the highlight also previews that category, so the channel list
      // always matches what is highlighted — but the rebuild is deferred.
      // Holding Down through eleven categories was rebuilding fifty rows and
      // their logos eleven times, and the highlight visibly lagged the remote.
      // Only the category the viewer settles on is worth drawing.
      const entry = (this.groupEntries || [])[this.groupIndex];
      if (entry && entry.key !== this.selectedGroupKey) {
        this.selectedGroupKey = entry.key;
        this.channelRenderLimit = CHANNEL_RENDER_STEP;
        this.channelIndex = 0;
        this.scheduleChannelRailRepaint();
      }
      return;
    }

    const count = this.channelRowCount || 0;
    if (!count) {
      return;
    }
    const previousIndex = this.channelIndex;
    this.channelIndex = clampIndex(this.channelIndex + delta, count);

    // Grow the rendered window before the highlight can reach its edge. Wrapping
    // from the last row back to the first is the one case that needs a full
    // repaint, because the window has to shrink back to the top.
    const limit = Number(this.channelRenderLimit || CHANNEL_RENDER_STEP);
    if (this.channelIndex + CHANNEL_PREFETCH_ROWS >= limit && limit < count) {
      this.channelRenderLimit = Math.min(count, limit + CHANNEL_RENDER_STEP);
      this.replaceChannelRail();
    } else {
      this.updateFocusedRow(ZONE_CHANNELS, previousIndex, this.channelIndex);
    }
    this.probeVisibleChannels();
  },

  setZone(zone) {
    if (this.focusZone === zone) {
      return;
    }
    this.focusZone = zone;
    // The dimming of the inactive rail is a class on the rail itself, so a zone
    // change repaints both rails' state without rebuilding their rows.
    this.container?.querySelectorAll(".iptv-rail").forEach((rail) => {
      const railZone = rail.querySelector("[data-scroll]")?.dataset.scroll;
      rail.classList.toggle("zone-active", railZone === zone);
    });
    this.syncDomFocusToZone();
  },

  /** Moves the `.focused` class between two rows and scrolls the new one in. */
  updateFocusedRow(zone, previousIndex, nextIndex) {
    if (!this.container) {
      return;
    }
    const rowAt = (index) =>
      this.container.querySelector(`[data-zone="${zone}"][data-row="${index}"]`);
    if (previousIndex !== nextIndex) {
      rowAt(previousIndex)?.classList.remove("focused");
    }
    const next = rowAt(nextIndex);
    if (!next) {
      // The row is outside the rendered window; a repaint will place it.
      this.replaceChannelRail();
      return;
    }
    next.classList.add("focused");
    focusWithoutAutoScroll(next);
    this.scrollRowIntoView(next);
  },

  /**
   * Scrolls a rail so the focused row sits inside it with context above and
   * below.
   *
   * Written as explicit offset maths rather than `scrollIntoView({block:
   * "nearest"})`: on the TV's engine that call also scrolls ancestors, which
   * drags the whole page under the fixed sidebar, and it parks the highlight
   * flush against the edge of the list with nothing visible beyond it.
   */
  scrollRowIntoView(row) {
    const rail = row?.closest?.("[data-scroll]");
    if (!rail) {
      return;
    }
    const margin = row.offsetHeight * SCROLL_CONTEXT_ROWS;
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    const viewTop = rail.scrollTop;
    const viewBottom = viewTop + rail.clientHeight;

    if (rowTop - margin < viewTop) {
      rail.scrollTop = Math.max(0, rowTop - margin);
    } else if (rowBottom + margin > viewBottom) {
      rail.scrollTop = rowBottom + margin - rail.clientHeight;
    }
  },

  /**
   * Repaints the channel rail once the highlight settles.
   *
   * Deliberately short: long enough that a held key coalesces into one repaint,
   * short enough that a deliberate move feels immediate.
   */
  scheduleChannelRailRepaint() {
    if (this.channelRailTimer) {
      clearTimeout(this.channelRailTimer);
    }
    this.channelRailTimer = setTimeout(() => {
      this.channelRailTimer = null;
      this.replaceChannelRail();
      this.probeVisibleChannels();
    }, CHANNEL_RAIL_REPAINT_DELAY_MS);
  },

  /** Rebuilds only the channel rail, preserving the rest of the screen. */
  replaceChannelRail() {
    const existing = this.container?.querySelector(".iptv-channels");
    if (!existing) {
      this.render();
      return;
    }
    const holder = document.createElement("div");
    holder.innerHTML = this.renderChannelGrid();
    const next = holder.firstElementChild;
    if (!next) {
      return;
    }
    existing.replaceWith(next);
    ScreenUtils.indexFocusables(this.container);
    this.syncDomFocusToZone();
  },

  hasGroups() {
    return Boolean((this.groupEntries || []).length);
  },

  /** Mirrors the zone model onto real DOM focus and scrolls the highlight in. */
  syncDomFocusToZone() {
    if (!this.container) {
      return;
    }
    if (this.focusZone === ZONE_SIDEBAR) {
      const sidebarNode = getRootSidebarSelectedNode(this.container, this.layoutPrefs);
      if (sidebarNode) {
        focusWithoutAutoScroll(sidebarNode);
      }
      return;
    }
    const index = this.focusZone === ZONE_GROUPS ? this.groupIndex : this.channelIndex;
    const target = this.container.querySelector(
      `[data-zone="${this.focusZone}"][data-row="${index}"]`
    );
    if (!target) {
      return;
    }
    target.classList.add("focused");
    focusWithoutAutoScroll(target);
    this.scrollRowIntoView(target);
  },

  /**
   * Opens the TV's on-screen keyboard against the search field.
   *
   * Focusing a real <input> is what raises Tizen's IME; there is no API to
   * summon it directly. The field sits off-screen until then so it never
   * competes with the rails for D-pad focus.
   */
  beginChannelSearch() {
    const host = this.container?.querySelector("#iptvKeyboard");
    if (!host) {
      return;
    }
    this.selectedGroupKey = SEARCH_GROUP_KEY;
    this.container.classList.add("iptv-searching");
    this.keyboard = createVirtualKeyboard({
      container: host,
      value: this.searchQuery || "",
      placeholder: t("iptv_search_placeholder", {}, "Type a channel name"),
      onChange: (value) => {
        this.searchQuery = value;
        this.channelRenderLimit = CHANNEL_RENDER_STEP;
        this.channelIndex = 0;
        this.replaceChannelRail();
        this.updateSearchRailLabel();
        this.keyboard?.setSuggestions(this.channelSuggestions(value));
      },
      onSubmit: () => {
        this.endChannelSearch();
        if (this.searchResults().length) {
          this.channelIndex = 0;
          this.setZone(ZONE_CHANNELS);
        }
      },
      onCancel: () => this.endChannelSearch()
    });
    this.keyboard.render();
    this.keyboard.bindPointer();
    this.keyboard.setSuggestions(this.channelSuggestions(this.searchQuery || ""));
  },

  /**
   * Channel names to offer above the keys.
   *
   * Taken from the catalogue itself rather than a search history, so the
   * suggestions are always things that can actually be played, and typing three
   * letters is usually enough to stop typing.
   */
  channelSuggestions(query = "") {
    const key = normalizeSearchText(query);
    if (key.length < 2 || !this.snapshot) {
      return [];
    }
    // Names are compared with the resolution suffix stripped, so "Canal 5
    // (1080p)" and "Canal 5" are one suggestion rather than two.
    const seen = new Set();
    const starts = [];
    const contains = [];
    for (const channel of this.snapshot.channels) {
      const name = String(channel.name || "").replace(/\s*[([][^)\]]*[)\]]\s*$/, "");
      const normalized = normalizeSearchText(name);
      if (!normalized.includes(key) || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      // A name that starts with what was typed is almost always the intended
      // one, so those lead regardless of playlist order.
      (normalized.startsWith(key) ? starts : contains).push(name);
      if (starts.length >= 5) {
        break;
      }
    }
    return [...starts, ...contains].slice(0, 5);
  },

  endChannelSearch() {
    this.container?.classList.remove("iptv-searching");
    const host = this.container?.querySelector("#iptvKeyboard");
    if (host) {
      host.innerHTML = "";
    }
    this.keyboard = null;
    this.syncDomFocusToZone();
  },

  /** Refreshes just the search row's label and count. */
  updateSearchRailLabel() {
    const row = this.container?.querySelector(`[data-zone="${ZONE_GROUPS}"][data-row="0"]`);
    if (!row || this.groupEntries?.[0]?.key !== SEARCH_GROUP_KEY) {
      return;
    }
    const label = row.querySelector(".iptv-group-label");
    const count = row.querySelector(".iptv-group-count");
    if (label) {
      label.textContent = this.searchQuery
        ? t("iptv_search_active", { 1: this.searchQuery }, `Search: ${this.searchQuery}`)
        : t("iptv_search", {}, "Search channels");
    }
    if (count) {
      count.textContent = this.searchQuery ? String(this.searchResults().length) : "";
    }
  },

  activateFocused() {
    if (this.focusZone === ZONE_GROUPS) {
      const searchEntry = (this.groupEntries || [])[this.groupIndex];
      if (searchEntry?.key === SEARCH_GROUP_KEY) {
        this.beginChannelSearch();
        return;
      }
    }
    if (this.focusZone === ZONE_GROUPS) {
      // The category is already applied as the highlight moves, so Enter simply
      // advances into the channel list.
      if (this.visibleChannels().length) {
        this.channelIndex = 0;
        this.setZone(ZONE_CHANNELS);
      }
      return;
    }
    if (this.focusZone !== ZONE_CHANNELS) {
      return;
    }
    const channel = this.visibleChannels()[this.channelIndex];
    if (channel) {
      this.playChannel(channel.id);
    }
  },

  toggleFavorite(channelId) {
    this.settings = IptvSettingsStore.toggleFavorite(channelId);
    this.render();
  },

  findChannel(channelId) {
    return (this.snapshot?.channels || []).find((channel) => channel.id === channelId) || null;
  },

  async playChannel(channelId) {
    const channel = this.findChannel(channelId);
    if (!channel?.streamUrl) {
      return;
    }

    IptvSettingsStore.setLastChannelId(channel.id);
    // Selecting a channel is the strongest evidence it works, so clear any
    // stale dead record rather than making the viewer wait for a re-probe.
    markChannelAlive(channel.id);

    // Large playlists skip the upfront guide pass, so fetch this channel's
    // now/next on demand purely to label the player.
    let guide = this.snapshot?.nowNext?.[channel.id] || null;
    if (!guide && this.snapshot?.guideOnDemand) {
      guide = await loadChannelNowNext(channel, this.settings).catch(() => null);
      if (guide) {
        this.onDemandGuide.set(channel.id, guide);
      }
    }

    Router.navigate("player", {
      streamUrl: channel.streamUrl,
      itemType: "movie",
      isLiveChannel: true,
      playerTitle: channel.name,
      playerSubtitle: guide?.now?.title || "",
      playerLogoUrl: channel.logo || null,
      startFromBeginning: true
    });
  },

  cleanup() {
    // Bumping the token stops the in-flight guide sweep and health probes from
    // touching a screen the viewer has left.
    this.mountToken = Number(this.mountToken || 0) + 1;
    if (this.channelRailTimer) {
      clearTimeout(this.channelRailTimer);
      this.channelRailTimer = null;
    }
    this.snapshot = null;
    this.onDemandGuide = new Map();
    this.probedChannelIds = new Set();
    ScreenUtils.hide(this.container);
  }
};
