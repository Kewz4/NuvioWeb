// Mi Perfil.
//
// This page answers "what is mine?" — who is watching, what they saved, what
// they were part-way through — and it is also where the two controls the dock
// has no room for now live. It was briefly the library screen with a couple of
// buttons bolted into its heading; that page is a filterable, sortable grid
// built for someone managing a large collection, which is the opposite of what
// this household needs from a page called "my profile".
//
// The layout is three bands, largest first, because that is the order the
// questions get asked: who am I, what did I save, what am I in the middle of.
// Everything on it is one press from the dock and nothing is nested.

import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { I18n } from "../../../i18n/index.js";
import { savedLibraryRepository } from "../../../data/repository/savedLibraryRepository.js";
import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { getWatchProgressFraction } from "../../../domain/model/watchProgress.js";
import { escapeHtml, firstNonEmpty } from "../home/homeUtils.js";
import {
  bindRootSidebarEvents,
  getSidebarProfileState,
  renderRootSidebar
} from "../../components/sidebarNavigation.js";

// I18n.t reads options.fallback, so a bare third argument is ignored.
function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

// Enough to be worth looking at, few enough that the page stays one screen and
// the TV is not asked to decode a hundred posters to show a summary.
const MAX_SAVED = 12;
const MAX_CONTINUE = 8;

function posterUrl(entry = {}) {
  return firstNonEmpty(entry?.poster, entry?.posterUrl, entry?.enrichedMeta?.poster);
}

function entryTitle(entry = {}) {
  // Watch-progress rows store only an id; the readable name arrives later under
  // enrichedMeta, which is why every card showed "tt27419466".
  return firstNonEmpty(
    entry?.title,
    entry?.name,
    entry?.enrichedMeta?.name,
    entry?.enrichedMeta?.title,
    entry?.contentId,
    entry?.id
  );
}

/**
 * Percent watched, or 0 when nothing was measured.
 *
 * Through the shared helper because Trakt-sourced rows carry only a
 * progressPercent field, with positionMs and durationMs left at zero — deriving
 * it from those two alone drew an empty bar on every Trakt entry.
 */
function progressPercent(entry = {}) {
  return Math.max(0, Math.min(100, Math.round(getWatchProgressFraction(entry) * 100)));
}

function renderCard(entry, index, { showProgress = false } = {}) {
  const id = String(entry?.contentId || entry?.id || "").trim();
  if (!id) {
    return "";
  }
  const poster = posterUrl(entry);
  const title = entryTitle(entry);
  const percent = showProgress ? progressPercent(entry) : 0;

  return `
    <button class="myprofile-card focusable"
            type="button"
            data-zone="content"
            data-action="openDetail"
            data-content-id="${escapeHtml(id)}"
            data-content-type="${escapeHtml(entry?.contentType || entry?.type || "movie")}"
            data-index="${index}"
            aria-label="${escapeHtml(title)}">
      <span class="myprofile-card-art">
        ${
          poster
            ? `<img class="myprofile-card-image" src="${escapeHtml(poster)}" alt="" loading="lazy" />`
            : `<span class="myprofile-card-fallback">${escapeHtml(title.slice(0, 1).toUpperCase())}</span>`
        }
        ${percent > 0 ? `<span class="myprofile-card-progress"><span class="myprofile-card-progress-fill" style="width:${percent}%"></span></span>` : ""}
      </span>
      <span class="myprofile-card-title">${escapeHtml(title)}</span>
    </button>
  `;
}

function renderRow(titleText, entries, options = {}) {
  const cards = entries.map((entry, index) => renderCard(entry, index, options)).filter(Boolean);
  if (!cards.length) {
    return "";
  }
  return `
    <section class="myprofile-row">
      <h2 class="myprofile-row-title">${escapeHtml(titleText)}</h2>
      <div class="myprofile-row-track">${cards.join("")}</div>
    </section>
  `;
}

export const MyProfileScreen = {
  container: null,
  profile: null,
  enterReleaseHandler: null,
  saved: [],
  continueWatching: [],
  layoutPrefs: null,

  async mount() {
    this.container = document.getElementById("myProfile");
    ScreenUtils.show(this.container);
    this.layoutPrefs = LayoutPreferences.get();

    // Painted from whatever is already known before the reads finish, so the
    // page never shows a spinner where its own name should be. The library
    // screen's habit of replacing everything with "Sincronizando…" is what made
    // settings unreachable exactly when someone wanted them.
    this.profile = await getSidebarProfileState().catch(() => null);
    this.render();

    const [saved, recent] = await Promise.all([
      savedLibraryRepository.getAll(MAX_SAVED).catch(() => []),
      watchProgressRepository.getRecent(MAX_CONTINUE).catch(() => [])
    ]);
    this.saved = Array.isArray(saved) ? saved.slice(0, MAX_SAVED) : [];
    this.continueWatching = Array.isArray(recent) ? recent.slice(0, MAX_CONTINUE) : [];
    this.render();
  },

  cleanup() {
    ScreenUtils.hide(this.container);
    this.releaseEnterGuard();
    this.profile = null;
    this.saved = [];
    this.continueWatching = [];
  },

  renderIdentity() {
    const state = this.profile || {};
    const name = state.activeProfileName || t("sidebar.profileFallback", {}, "Perfil");
    const colour = state.activeProfileColorHex || "#1e88e5";
    const avatar = state.activeProfileAvatarUrl
      ? `<img class="myprofile-hero-avatar-image" src="${escapeHtml(state.activeProfileAvatarUrl)}" alt="" />`
      : escapeHtml(state.activeProfileInitial || name.charAt(0).toUpperCase() || "P");

    return `
      <section class="myprofile-hero">
        <span class="myprofile-hero-avatar" style="background:${escapeHtml(colour)}">${avatar}</span>
        <div class="myprofile-hero-copy">
          <h1 class="myprofile-hero-name">${escapeHtml(name)}</h1>
          <p class="myprofile-hero-caption">${escapeHtml(t("myProfile.caption", {}, "Tu lista y tus ajustes"))}</p>
        </div>
        <div class="myprofile-hero-actions">
          <button class="myprofile-action focusable" type="button" data-zone="content" data-action="switchProfile">
            ${escapeHtml(t("myProfile.switchProfile", {}, "Cambiar de perfil"))}
          </button>
          <button class="myprofile-action focusable" type="button" data-zone="content" data-action="openSettings">
            ${escapeHtml(t("myProfile.settings", {}, "Configuración"))}
          </button>
          <button class="myprofile-action focusable" type="button" data-zone="content" data-action="openLibrary">
            ${escapeHtml(t("myProfile.fullLibrary", {}, "Ver toda mi lista"))}
          </button>
        </div>
      </section>
    `;
  },

  renderEmpty() {
    if (this.saved.length || this.continueWatching.length) {
      return "";
    }
    return `
      <section class="myprofile-empty">
        <p class="myprofile-empty-title">${escapeHtml(t("myProfile.emptyTitle", {}, "Todavía no has guardado nada"))}</p>
        <p class="myprofile-empty-hint">${escapeHtml(t("myProfile.emptyHint", {}, "Lo que guardes aparecerá aquí."))}</p>
      </section>
    `;
  },

  render() {
    if (!this.container) {
      return;
    }
    this.container.innerHTML = `
      <div class="home-shell myprofile-shell">
        ${renderRootSidebar({
          selectedRoute: "myProfile",
          profile: this.profile,
          layout: this.layoutPrefs
        })}
        <main class="home-main myprofile-main">
          ${this.renderIdentity()}
          ${renderRow(t("myProfile.continue", {}, "Seguir viendo"), this.continueWatching, { showProgress: true })}
          ${renderRow(t("myProfile.library", {}, "Mi lista"), this.saved)}
          ${this.renderEmpty()}
        </main>
      </div>
    `;

    bindRootSidebarEvents(this.container, { currentRoute: "myProfile" });
    this.bindContent();
    ScreenUtils.setInitialFocus(this.container, ".myprofile-action.focusable");
    // The press that opened this screen is still held. Its repeat and its keyup
    // land here, on whatever now has focus — and the first action is "Cambiar de
    // perfil", so a single press on Mi Perfil went straight through to the
    // profile chooser. Enter is ignored until the key has been released once.
    this.armEnterAfterRelease();
  },

  bindContent() {
    this.container?.querySelectorAll('[data-zone="content"]').forEach((node) => {
      node.onclick = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this.activate(node);
      };
    });
  },

  activate(node) {
    const action = String(node?.dataset?.action || "");
    if (action === "switchProfile") {
      Router.navigate("profileSelection");
      return;
    }
    if (action === "openSettings") {
      Router.navigate("settings");
      return;
    }
    if (action === "openLibrary") {
      Router.navigate("library");
      return;
    }
    if (action === "openDetail") {
      const itemId = String(node.dataset.contentId || "");
      if (!itemId) {
        return;
      }
      Router.navigate("detail", {
        itemId,
        itemType: node.dataset.contentType === "series" ? "series" : "movie"
      });
    }
  },

  /**
   * Ignores Enter until the key that brought us here has been let go.
   *
   * Cheaper and more reliable than a timer: it keys off the actual release
   * rather than guessing how long a press lasts.
   */
  armEnterAfterRelease() {
    if (this.enterReleaseHandler) {
      // Already waiting for the release; re-arming would only reset the wait
      // after the viewer may have let go.
      return;
    }
    this.enterReleaseHandler = (event) => {
      if (Number(event?.keyCode || 0) !== 13) {
        return;
      }
      this.releaseEnterGuard();
    };
    globalThis.addEventListener("keyup", this.enterReleaseHandler, true);
  },

  releaseEnterGuard() {
    if (!this.enterReleaseHandler) {
      return;
    }
    globalThis.removeEventListener("keyup", this.enterReleaseHandler, true);
    this.enterReleaseHandler = null;
  },

  /**
   * The page as rows of focusable things, top to bottom.
   *
   * Read from the DOM rather than kept in sync with it: the page is small and
   * rebuilt whole on every render, so a cached model would only be one more
   * thing able to disagree with what is on screen.
   */
  navigationRows() {
    const rows = [];
    const actions = Array.from(this.container?.querySelectorAll(".myprofile-action") || []);
    if (actions.length) {
      rows.push(actions);
    }
    this.container?.querySelectorAll(".myprofile-row-track").forEach((track) => {
      const cards = Array.from(track.querySelectorAll(".myprofile-card"));
      if (cards.length) {
        rows.push(cards);
      }
    });
    return rows;
  },

  focusNode(target) {
    if (!target) {
      return false;
    }
    this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) {
        node.classList.remove("focused");
      }
    });
    target.classList.add("focused");
    target.focus?.({ preventScroll: true });
    // Keeps the focused card on screen without scrolling the page under the
    // dock, which scrollIntoView would do.
    const track = target.closest(".myprofile-row-track");
    if (track) {
      const card = target.getBoundingClientRect();
      const view = track.getBoundingClientRect();
      if (card.left < view.left) {
        track.scrollLeft -= Math.round(view.left - card.left) + 24;
      } else if (card.right > view.right) {
        track.scrollLeft += Math.round(card.right - view.right) + 24;
      }
    }
    target.closest(".myprofile-row, .myprofile-hero")?.scrollIntoView?.({
      block: "nearest"
    });
    return true;
  },

  /** Where focus lands when the dock hands it back. */
  focusContentFromTopBar() {
    const rows = this.navigationRows();
    return this.focusNode(rows[0]?.[0] || null);
  },

  moveFocus(direction) {
    const rows = this.navigationRows();
    if (!rows.length) {
      return false;
    }
    const current = this.container?.querySelector(".focusable.focused");
    let rowIndex = rows.findIndex((row) => row.includes(current));
    let colIndex = rowIndex >= 0 ? rows[rowIndex].indexOf(current) : 0;
    if (rowIndex < 0) {
      return this.focusNode(rows[0][0]);
    }

    if (direction === "left" || direction === "right") {
      const next = colIndex + (direction === "right" ? 1 : -1);
      if (next < 0 || next >= rows[rowIndex].length) {
        // Consumed at the ends so focus cannot escape the page sideways.
        return true;
      }
      return this.focusNode(rows[rowIndex][next]);
    }

    const nextRow = rowIndex + (direction === "down" ? 1 : -1);
    if (nextRow < 0 || nextRow >= rows.length) {
      // Off the top is the dock's business, handled before this screen is asked.
      return false;
    }
    // Keep the column where it can, so moving down a list of cards does not
    // jump back to the first one.
    const target = rows[nextRow][Math.min(colIndex, rows[nextRow].length - 1)];
    return this.focusNode(target);
  },

  onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
    const direction = { 37: "left", 38: "up", 39: "right", 40: "down" }[code];
    if (direction) {
      if (this.moveFocus(direction)) {
        event?.preventDefault?.();
        return true;
      }
      return false;
    }
    // Still holding the Enter that opened this screen: see armEnterAfterRelease.
    if (code === 13 && this.enterReleaseHandler) {
      event?.preventDefault?.();
      return true;
    }
    if (code === 13) {
      const focused = this.container?.querySelector(".focusable.focused");
      if (focused?.dataset?.zone === "content") {
        event?.preventDefault?.();
        this.activate(focused);
        return true;
      }
    }
    return false;
  },

  /** Re-selecting Mi Perfil in the dock refreshes it rather than reloading. */
  onSidebarReselect() {
    this.container?.querySelector(".myprofile-main")?.scrollTo?.({ top: 0, behavior: "smooth" });
  }
};
