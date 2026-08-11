// The floating top bar.
//
// Replaces the left sidebar with the arrangement people already know from
// Netflix: a search icon, then the sections as words, then the profile. The
// sidebar cost a horizontal press to open and put the sections behind an icon
// each; on a remote, a row of labelled words is one press away and reads
// without being decoded.
//
// The bar is transparent over the top of a page and fades in a backdrop once
// the content scrolls under it, so artwork is never boxed in by a permanent
// band. Where the platform can afford it that backdrop is a real blur; on a TV
// it is a gradient, because backdrop-filter is composited every frame and these
// panels cannot pay for it (see applyPerformanceMode, which turns blur off for
// all of Tizen).

import { Router } from "../navigation/router.js";
import { I18n } from "../../i18n/index.js";

const t = (key, params, fallback) => I18n.t(key, params, fallback);

// Order is the user's: search, then sections left to right, then the profile.
// "TV" keeps its short name rather than "Televisión en vivo" — it sits between
// two longer words and the row has to stay scannable at three metres.
export const TOP_BAR_ITEMS = [
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

export function topBarItemLabel(item) {
  return t(item?.labelKey, {}, item?.fallbackLabel || "");
}

/** The tab a route belongs to, following aliases. */
export function resolveTopBarRoute(route = "") {
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

function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function profileAvatarMarkup(profile = {}) {
  const name = profile.activeProfileName || t("sidebar.profileFallback", {}, "Perfil");
  const background = profile.activeProfileColorHex || "#1e88e5";
  const inner = profile.activeProfileAvatarUrl
    ? `<img class="top-bar-avatar-image" src="${escapeHtml(profile.activeProfileAvatarUrl)}" alt="" aria-hidden="true" />`
    : escapeHtml(profile.activeProfileInitial || name.charAt(0).toUpperCase() || "P");
  return `<span class="top-bar-avatar" style="background:${escapeHtml(background)}">${inner}</span>`;
}

/**
 * The bar's markup.
 *
 * Rendered as one block per screen rather than kept alive across navigations,
 * matching how every other chrome element in the app works; it is a handful of
 * nodes, so re-rendering it costs less than the bookkeeping to preserve it.
 */
export function renderTopBar({ selectedRoute = "home", profile = null, scrolled = false } = {}) {
  const selected = resolveTopBarRoute(selectedRoute);
  const profileState = profile || {};

  const items = TOP_BAR_ITEMS.map((item, index) => {
    const isSelected = item.route === selected;
    const label = topBarItemLabel(item);
    const body = item.isProfile
      ? `${profileAvatarMarkup(profileState)}<span class="top-bar-label">${escapeHtml(label)}</span>`
      : item.iconOnly
        ? `<svg class="top-bar-icon" viewBox="${item.viewBox}" aria-hidden="true" focusable="false">${item.iconMarkup}</svg>`
        : `<span class="top-bar-label">${escapeHtml(label)}</span>`;

    return `
      <button class="top-bar-item focusable${isSelected ? " selected" : ""}${item.iconOnly ? " icon-only" : ""}${item.isProfile ? " top-bar-profile" : ""}"
              type="button"
              data-nav-zone="sidebar"
              data-nav-index="${index}"
              data-action="${item.action}"
              aria-label="${escapeHtml(label)}"
              aria-current="${isSelected ? "page" : "false"}">
        ${body}
      </button>
    `;
  }).join("");

  return `
    <nav class="top-bar${scrolled ? " is-scrolled" : ""}" data-selected-route="${escapeHtml(selected)}" aria-label="${escapeHtml(t("topbar.ariaLabel", {}, "Navegación principal"))}">
      <div class="top-bar-inner">${items}</div>
    </nav>
  `;
}

export function getTopBarNodes(container) {
  return Array.from(container?.querySelectorAll(".top-bar .focusable") || []);
}

export function getTopBarSelectedNode(container) {
  return (
    container?.querySelector(".top-bar .focusable.selected") ||
    container?.querySelector(".top-bar .focusable") ||
    null
  );
}

export function isTopBarNode(node) {
  return Boolean(node?.closest?.(".top-bar"));
}

/**
 * Fades the backdrop in once content has scrolled under the bar.
 *
 * Toggles one class and nothing else: the transition is a CSS opacity change on
 * a layer that is already composited, so scrolling never triggers layout.
 */
export function setTopBarScrolled(container, scrolled) {
  const bar = container?.querySelector(".top-bar");
  if (!bar) {
    return;
  }
  bar.classList.toggle("is-scrolled", Boolean(scrolled));
}

/** Runs a top bar action. Mirrors activateLegacySidebarAction's contract. */
export function activateTopBarAction(action, currentRoute = "") {
  const normalized = String(action || "").trim();
  if (!normalized) {
    return;
  }
  const target = getTopBarItemForAction(normalized);
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

/** The dock button that currently has focus, or null. */
export function getFocusedTopBarNode(container = globalThis.document) {
  const active = container?.activeElement || globalThis.document?.activeElement || null;
  if (isTopBarNode(active)) {
    return active;
  }
  // Focus classes are the app's own notion of focus and can lead the DOM's.
  return globalThis.document?.querySelector(".top-bar .focusable.focused") || null;
}

function moveWithinTopBar(node, delta) {
  const nodes = getTopBarNodes(node.closest(".top-bar") || globalThis.document);
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
  nodes.forEach((entry) => entry.classList.remove("focused"));
  target.classList.add("focused");
  target.focus?.({ preventScroll: true });
  return true;
}

/**
 * The screen the dock belongs to.
 *
 * Derived from the dock element rather than by looking for a visible .screen:
 * the dock is position:fixed, so its offsetParent is always null and any
 * visibility test on it answers the wrong question. Only one screen holds a
 * dock at a time, so this is exact.
 */
function currentScreenRoot() {
  const bar = globalThis.document?.querySelector(".top-bar");
  return bar?.closest(".screen") || null;
}

function contentFocusables(root = currentScreenRoot()) {
  return Array.from(root?.querySelectorAll(".focusable") || []).filter(
    (node) => !isTopBarNode(node) && node.offsetParent !== null
  );
}

/**
 * The first thing a screen's content offers, ignoring the dock.
 *
 * Used when leaving the dock downwards on a screen that has no opinion of its
 * own about where focus should land.
 */
function firstContentFocusable() {
  return contentFocusables()[0] || null;
}

/**
 * Whether the focused content sits in the topmost row of the page.
 *
 * The dock is above everything, so "up" from the top row should reach it. Rather
 * than each screen declaring where its top is, this compares the focused
 * element against the highest focusable on the page — which is true whatever
 * that screen's layout happens to be.
 */
function isInTopmostContentRow(node) {
  if (!node || isTopBarNode(node)) {
    return false;
  }
  const nodes = contentFocusables(node.closest(".screen"));
  if (!nodes.length) {
    return false;
  }
  const top = Math.min(...nodes.map((entry) => entry.getBoundingClientRect().top));
  // A row's cards are not pixel-aligned, so a small tolerance keeps a whole row
  // counting as the top one.
  return node.getBoundingClientRect().top - top < 24;
}

/**
 * The dock's key handling, for every screen at once.
 *
 * Lives here and is called by the focus engine before the screen sees the key,
 * because the dock is app chrome rather than part of any screen. Two owners is
 * what produced the earlier bugs: a screen navigating its own cards while the
 * dock had focus, and arrow presses being acted on twice.
 *
 * @returns {boolean} true when the dock consumed the key.
 */
export function handleTopBarKey(event, { onLeaveDown = null } = {}) {
  const keyCode = Number(event?.keyCode || 0);
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
      // The screen knows best where focus belongs; the generic answer is only
      // used when it has no opinion.
      const handled = typeof onLeaveDown === "function" ? onLeaveDown(focused) : false;
      if (!handled) {
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
    if (keyCode === 13) {
      event?.preventDefault?.();
      activateTopBarAction(String(focused.dataset.action || ""), Router.getCurrent?.() || "");
      return true;
    }
    return false;
  }

  // Coming back up from the top row of the content.
  if (keyCode === 38) {
    const active =
      globalThis.document?.querySelector(".screen:not(.hidden) .focusable.focused") ||
      globalThis.document?.activeElement ||
      null;
    if (isInTopmostContentRow(active)) {
      const target = getTopBarSelectedNode(currentScreenRoot() || globalThis.document);
      if (target) {
        event?.preventDefault?.();
        active.classList?.remove("focused");
        target.classList.add("focused");
        target.focus?.({ preventScroll: true });
        return true;
      }
    }
  }
  return false;
}

/** Wires clicks. Keys are owned by handleTopBarKey, called by the focus engine. */
export function bindTopBarEvents(container, { currentRoute = "", onSelectedAction = null } = {}) {
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
    // Deliberately no onkeydown: see handleTopBarKey.
    node.onkeydown = null;
  });
}
