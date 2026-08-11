// The floating top bar.
//
// Replaces the left sidebar with the arrangement people already know from
// Netflix: a search icon, then the sections as words, then the profile. The
// sidebar cost a horizontal press to open and put the sections behind an icon
// each; on a remote, a row of labelled words is one press away and reads
// without being decoded.
//
// The dock is app chrome, not part of any screen, so it owns its keys here and
// the focus engine calls handleTopBarKey before handing anything to the screen.
// Two owners is what produced the earlier bugs: screens moving their own cards
// while the dock had focus, and arrow presses acted on twice.
//
// handleTopBarKey runs on every key press the app sees, including during
// playback, so it is written to cost almost nothing when the answer is no: a
// numeric gate first, then a held element reference, and no document queries at
// all on the common path.

import { Router } from "../navigation/router.js";
import { I18n } from "../../i18n/index.js";
import { escapeAttribute, escapeHtml } from "../screens/home/homeUtils.js";

// Matches the wrapper the rest of the UI uses. I18n.t reads options.fallback,
// so a bare third argument is silently ignored — every fallback here was inert
// until this took the same shape as sidebarNavigation's.
function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

// Order is the user's: search, then sections left to right, then the profile.
// "TV" keeps its short name rather than "Televisión en vivo" — it sits between
// two longer words and the row has to stay scannable at three metres.
const TOP_BAR_ITEMS = [
  {
    action: "gotoSearch",
    route: "search",
    labelKey: "sidebar.search",
    fallbackLabel: "Buscar",
    // The only item shown as an icon, exactly as Netflix does it: search is a
    // verb, not a place, and the magnifier says so without a word.
    iconOnly: true,
    viewBox: "0 0 20 20",
    iconMarkup:
      '<path fill-rule="evenodd" d="M4 9a5 5 0 1110 0A5 5 0 014 9zm5-7a7 7 0 104.2 12.6.999.999 0 00.093.107l3 3a1 1 0 001.414-1.414l-3-3a.999.999 0 00-.107-.093A7 7 0 009 2z"/>'
  },
  { action: "gotoHome", route: "home", labelKey: "topbar.home", fallbackLabel: "Inicio" },
  { action: "gotoSeries", route: "series", labelKey: "topbar.series", fallbackLabel: "Series" },
  { action: "gotoMovies", route: "movies", labelKey: "topbar.movies", fallbackLabel: "Películas" },
  { action: "gotoSports", route: "sports", labelKey: "topbar.sports", fallbackLabel: "Deportes" },
  { action: "gotoIptv", route: "iptv", labelKey: "topbar.tv", fallbackLabel: "TV" },
  {
    action: "gotoMyProfile",
    route: "myProfile",
    labelKey: "topbar.myProfile",
    fallbackLabel: "Mi Perfil",
    isProfile: true
  }
];

// Routes that are not tabs of their own but belong to one, so the bar still
// shows where you are instead of highlighting nothing.
const ROUTE_ALIASES = {
  library: "myProfile",
  settings: "myProfile",
  profileSelection: "myProfile",
  discover: "search",
  catalogSeeAll: "home"
};

/** The tab a route belongs to, following aliases. */
function resolveTopBarRoute(route = "") {
  const normalized = String(route || "").trim();
  return ROUTE_ALIASES[normalized] || normalized;
}

export function getTopBarItemForAction(action = "") {
  const normalized = String(action || "").trim();
  return TOP_BAR_ITEMS.find((item) => item.action === normalized) || null;
}

export function isSelectedTopBarAction(action = "", selectedRoute = "") {
  const item = getTopBarItemForAction(action);
  return Boolean(item) && item.route === resolveTopBarRoute(selectedRoute);
}

function profileAvatarMarkup(profile = {}) {
  const name = profile.activeProfileName || t("sidebar.profileFallback", {}, "Perfil");
  const background = profile.activeProfileColorHex || "#1e88e5";
  const inner = profile.activeProfileAvatarUrl
    ? `<img class="top-bar-avatar-image" src="${escapeAttribute(profile.activeProfileAvatarUrl)}" alt="" aria-hidden="true" />`
    : escapeHtml(profile.activeProfileInitial || name.charAt(0).toUpperCase() || "P");
  return `<span class="top-bar-avatar" style="background:${escapeAttribute(background)}">${inner}</span>`;
}

/**
 * The bar's markup.
 *
 * Rendered as one block per screen rather than kept alive across navigations,
 * matching how every other chrome element in the app works; it is a handful of
 * nodes, so re-rendering it costs less than the bookkeeping to preserve it.
 */
export function renderTopBar({ selectedRoute = "home", profile = null } = {}) {
  const selected = resolveTopBarRoute(selectedRoute);
  const profileState = profile || {};

  const items = TOP_BAR_ITEMS.map((item, index) => {
    const isSelected = item.route === selected;
    const label = t(item.labelKey, {}, item.fallbackLabel);
    const body = item.isProfile
      ? `${profileAvatarMarkup(profileState)}<span class="top-bar-label" data-i18n="${escapeAttribute(item.labelKey)}" data-i18n-fallback="${escapeAttribute(item.fallbackLabel)}">${escapeHtml(label)}</span>`
      : item.iconOnly
        ? `<svg class="top-bar-icon" viewBox="${escapeAttribute(item.viewBox)}" aria-hidden="true" focusable="false">${item.iconMarkup}</svg>`
        : `<span class="top-bar-label" data-i18n="${escapeAttribute(item.labelKey)}" data-i18n-fallback="${escapeAttribute(item.fallbackLabel)}">${escapeHtml(label)}</span>`;

    return `
      <button class="top-bar-item focusable${isSelected ? " selected" : ""}${item.iconOnly ? " icon-only" : ""}${item.isProfile ? " top-bar-profile" : ""}"
              type="button"
              data-nav-zone="topbar"
              data-nav-index="${index}"
              data-action="${escapeAttribute(item.action)}"
              aria-label="${escapeAttribute(label)}"
              aria-current="${isSelected ? "page" : "false"}">
        ${body}
      </button>
    `;
  }).join("");

  return `
    <nav class="top-bar" data-selected-route="${escapeAttribute(selected)}" aria-label="${escapeAttribute(t("topbar.ariaLabel", {}, "Navegación principal"))}">
      <div class="top-bar-inner">${items}</div>
    </nav>
  `;
}

/* Key handling ------------------------------------------------------------- */

// The dock element, remembered when it is bound. Everything below used to find
// it with a document-wide query on every key press — including keys the dock can
// never act on, and on screens that have no dock at all. A held reference makes
// the common answer a null check.
let boundBar = null;
let focusedDockNode = null;

function liveBar() {
  if (boundBar?.isConnected) {
    return boundBar;
  }
  boundBar = null;
  focusedDockNode = null;
  return null;
}

export function isTopBarNode(node) {
  return Boolean(node?.closest?.(".top-bar"));
}

export function getTopBarNodes(container) {
  if (!container) {
    return [];
  }
  // Accepts the dock itself or any ancestor of it.
  const scope = container.classList?.contains("top-bar")
    ? container
    : container.querySelector?.(".top-bar");
  return scope ? Array.from(scope.querySelectorAll(".focusable")) : [];
}

export function getTopBarSelectedNode(container) {
  if (!container) {
    return null;
  }
  const scope = container.classList?.contains("top-bar")
    ? container
    : container.querySelector?.(".top-bar");
  return scope
    ? scope.querySelector(".focusable.selected") || scope.querySelector(".focusable")
    : null;
}

/** The dock button that currently has focus, or null. */
export function getFocusedTopBarNode() {
  const bar = liveBar();
  if (!bar) {
    return null;
  }
  if (focusedDockNode?.isConnected) {
    return focusedDockNode;
  }
  // Only reached after a re-render replaced the nodes we were holding.
  focusedDockNode = bar.querySelector(".focusable.focused");
  return focusedDockNode;
}

function focusDockNode(target) {
  if (!target) {
    return false;
  }
  getTopBarNodes(liveBar()).forEach((entry) => entry.classList.remove("focused"));
  target.classList.add("focused");
  focusedDockNode = target;
  try {
    target.focus({ preventScroll: true });
  } catch (_) {
    try {
      target.focus();
    } catch (_) {
      // Some TV builds reject both; the focus class is what the app reads.
    }
  }
  return true;
}

function moveWithinTopBar(node, delta) {
  const nodes = getTopBarNodes(liveBar());
  const index = nodes.indexOf(node);
  if (index === -1) {
    return false;
  }
  const target = nodes[Math.max(0, Math.min(nodes.length - 1, index + delta))];
  if (!target || target === node) {
    // At an end. Consumed anyway, so focus never escapes sideways into whatever
    // happens to be next in the document.
    return true;
  }
  return focusDockNode(target);
}

/**
 * The first thing the content offers, ignoring the dock.
 *
 * Stops at the first hit rather than collecting every focusable and taking
 * index zero — on Home that is a walk of one node instead of about 130.
 */
function firstContentFocusable() {
  const bar = liveBar();
  const root = bar?.closest?.(".screen");
  for (const node of root?.querySelectorAll(".focusable") || []) {
    if (!bar.contains(node) && node.offsetParent !== null) {
      return node;
    }
  }
  return null;
}

/**
 * Whether the focused content sits in the topmost row, so "up" means the dock.
 *
 * Asks the screen first, because a screen that models its own rows already knows
 * this for free. The fallback measures two rectangles rather than every
 * focusable on the page — which is what this did at first: roughly 130
 * getBoundingClientRect calls and a forced full-page layout, on every press of
 * up, on the device this was all meant to speed up.
 */
function isInTopmostContentRow(node, screen) {
  if (!node || isTopBarNode(node)) {
    return false;
  }
  const asked = screen?.isAtTopContentRow?.(node);
  if (typeof asked === "boolean") {
    return asked;
  }
  const row = node.dataset?.navRow;
  if (row !== undefined) {
    return row === "0";
  }
  const container = node.closest("main, .screen");
  if (!container) {
    return false;
  }
  const clearance = parseFloat(getComputedStyle(container).paddingTop) || 0;
  // A row's cards are not pixel-aligned, so a tolerance keeps a whole row
  // counting as the top one.
  return (
    node.getBoundingClientRect().top - (container.getBoundingClientRect().top + clearance) < 48
  );
}

/**
 * Runs a dock action.
 *
 * Exported because every screen routes its chrome clicks through
 * activateLegacySidebarAction, which falls through to here for the sections the
 * sidebar never had.
 */
export function activateTopBarAction(action, currentRoute = "") {
  const target = getTopBarItemForAction(action);
  if (!target) {
    return;
  }
  if (target.route === resolveTopBarRoute(currentRoute)) {
    // Re-selecting the tab you are on scrolls it back to the top rather than
    // reloading it, which is what every TV app does and what makes the bar
    // usable as a "take me back up" control.
    Router.getCurrentScreen()?.onSidebarReselect?.();
    return;
  }
  Router.navigate(target.route);
}

/**
 * The dock's key handling, for every screen at once.
 *
 * @param {object} event normalized keydown
 * @param {object|null} screen the current screen, asked where focus belongs
 * @returns {boolean} true when the dock consumed the key
 */
export function handleTopBarKey(event, screen = null) {
  const keyCode = Number(event?.keyCode || 0);
  // Gated before anything touches the DOM. Playback alone sends seek, colour and
  // number keys the dock can never act on.
  if (keyCode !== 13 && (keyCode < 37 || keyCode > 40)) {
    return false;
  }
  if (!liveBar()) {
    return false;
  }

  const focused = getFocusedTopBarNode();
  if (focused) {
    if (keyCode === 37 || keyCode === 39) {
      event?.preventDefault?.();
      moveWithinTopBar(focused, keyCode === 37 ? -1 : 1);
      return true;
    }
    if (keyCode === 40) {
      event?.preventDefault?.();
      focused.classList.remove("focused");
      focusedDockNode = null;
      // The screen knows best where focus belongs; the generic answer is only
      // used when it has no opinion.
      if (!screen?.focusContentFromTopBar?.(focused)) {
        const target = firstContentFocusable();
        if (target) {
          target.classList.add("focused");
          target.focus?.({ preventScroll: true });
        }
      }
      return true;
    }
    if (keyCode === 38) {
      // Nothing above the dock. Consumed so focus does not fall out of it.
      event?.preventDefault?.();
      return true;
    }
    event?.preventDefault?.();
    activateTopBarAction(String(focused.dataset.action || ""), Router.getCurrent?.() || "");
    return true;
  }

  // Coming back up from the top row of the content.
  if (keyCode === 38) {
    const active = globalThis.document?.activeElement || null;
    if (isInTopmostContentRow(active, screen)) {
      const target = getTopBarSelectedNode(liveBar());
      if (target) {
        event?.preventDefault?.();
        active.classList?.remove("focused");
        focusDockNode(target);
        return true;
      }
    }
  }
  return false;
}

/** Wires clicks. Keys are owned by handleTopBarKey, called by the focus engine. */
export function bindTopBarEvents(container, { currentRoute = "", onSelectedAction = null } = {}) {
  // Remembered so the key handler never has to look for it. Screens replace
  // their markup wholesale, so this is refreshed on every bind and liveBar()
  // drops it once the node leaves the document.
  boundBar = container?.querySelector?.(".top-bar") || null;
  focusedDockNode = null;

  getTopBarNodes(container).forEach((node) => {
    node.onclick = async (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      const action = String(node.dataset.action || "");
      activateTopBarAction(action, currentRoute);
      if (isSelectedTopBarAction(action, currentRoute) && typeof onSelectedAction === "function") {
        await onSelectedAction(node);
      }
    };
  });
}
