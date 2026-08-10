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
import {
  bindRootSidebarEvents,
  getSidebarProfileState,
  renderRootSidebar
} from "../../components/sidebarNavigation.js";

const t = (key, params, fallback) => I18n.t(key, params, fallback);

// Enough to be worth looking at, few enough that the page stays one screen and
// the TV is not asked to decode a hundred posters to show a summary.
const MAX_SAVED = 12;
const MAX_CONTINUE = 8;

function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function posterUrl(entry = {}) {
  return String(entry?.poster || entry?.posterUrl || entry?.enrichedMeta?.poster || "").trim();
}

function entryTitle(entry = {}) {
  return String(entry?.title || entry?.name || entry?.contentId || "").trim();
}

/** Percent watched, or 0 when the player never measured it. */
function progressPercent(entry = {}) {
  const position = Number(entry?.positionMs || 0) || 0;
  const duration = Number(entry?.durationMs || 0) || 0;
  if (!duration) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((position / duration) * 100)));
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

  onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
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
