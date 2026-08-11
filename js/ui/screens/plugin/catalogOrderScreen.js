import { Router } from "../../navigation/router.js";
import { I18n } from "../../../i18n/index.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";
import { getTabCatalogStore } from "../../../data/local/tabCatalogStore.js";
import { filterByTabType, homeTabTitle, isHomeTabRoute } from "../home/homeTabs.js";
import { CollectionsStore } from "../../../data/local/collectionsStore.js";
import {
  buildOrderedHomeCatalogItems,
  toDisplayTypeLabel
} from "../../../core/addons/homeCatalogs.js";
import { Platform } from "../../../platform/index.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function t(key, params = {}, fallback = "") {
  return I18n.t(key, params, { fallback: fallback || key });
}

export const CatalogOrderScreen = {
  /**
   * The preference store this screen is editing.
   *
   * Opened from a tab it edits that tab's arrangement; opened from settings it
   * edits Home's, which is what it has always done. Resolved per call rather
   * than cached so returning to it after switching tabs cannot edit the last
   * tab's rows by mistake.
   */
  prefsStore() {
    return getTabCatalogStore(this.scope) || HomeCatalogStore;
  },

  /** The rows this scope is allowed to arrange. */
  scopedItems(items = []) {
    return filterByTabType(this.scope, items);
  },

  async mount(params = {}) {
    // "" means Home, which keeps every existing entry point working unchanged.
    this.scope = isHomeTabRoute(params?.scope) ? String(params.scope) : "";
    this.container = document.getElementById("catalogOrder");
    ScreenUtils.show(this.container);
    this.focusRow = Number.isFinite(this.focusRow) ? this.focusRow : 0;
    this.focusCol = Number.isFinite(this.focusCol) ? this.focusCol : 0;
    await this.render();
  },

  async collectModel() {
    const addons = await addonRepository.getInstalledAddons();
    const collections = CollectionsStore.get();
    const prefs = this.prefsStore().get();
    return {
      // A tab may only arrange its own rows; offering Home's whole list would
      // let someone reorder films from inside Deportes and see nothing happen.
      // Collections are the exception — they are whatever their owner put in
      // them, so every scope offers them and the viewer decides.
      items: this.scopedItems(
        buildOrderedHomeCatalogItems(
          addons,
          collections,
          prefs.order,
          prefs.disabled,
          prefs.customTitles
        )
      )
    };
  },

  setRowColumns(row, cols) {
    this.rowColumns.set(row, cols);
  },

  getRows() {
    return [...this.rowColumns.keys()].sort((left, right) => left - right);
  },

  getCols(row) {
    return this.rowColumns.get(row) || [0];
  },

  normalizeFocus() {
    const rows = this.getRows();
    if (!rows.length) {
      this.focusRow = 0;
      this.focusCol = 0;
      return;
    }
    this.focusRow = rows.includes(this.focusRow)
      ? this.focusRow
      : rows[clamp(this.focusRow, 0, rows.length - 1)];
    const cols = this.getCols(this.focusRow);
    this.focusCol = cols.includes(this.focusCol) ? this.focusCol : cols[0];
  },

  ensureVisibility(target) {
    const container = this.container?.querySelector(".catalog-order-main");
    if (!container || !target) {
      return;
    }
    const anchor = target.closest(".catalog-order-card") || target;
    const pad = 56;
    const containerRect = container.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const anchorTop = anchorRect.top - containerRect.top + container.scrollTop;
    const anchorBottom = anchorRect.bottom - containerRect.top + container.scrollTop;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (anchorBottom > viewBottom - pad) {
      container.scrollTop = Math.min(
        container.scrollHeight - container.clientHeight,
        Math.max(0, anchorBottom - container.clientHeight + pad)
      );
    } else if (anchorTop < viewTop + pad) {
      container.scrollTop = Math.max(0, anchorTop - pad);
    }
  },

  applyFocus() {
    this.container
      ?.querySelectorAll(".catalog-order-focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    const target =
      this.container?.querySelector(
        `.catalog-order-focusable[data-row="${this.focusRow}"][data-col="${this.focusCol}"]`
      ) ||
      this.container?.querySelector(
        `.catalog-order-focusable[data-row="${this.focusRow}"][data-col="0"]`
      ) ||
      this.container?.querySelector(".catalog-order-focusable");

    if (!target) {
      return;
    }
    target.classList.add("focused");
    this.ensureVisibility(target);
    target.focus();
  },

  async moveItem(key, direction) {
    const current = this.model.items.map((item) => item.key);
    const index = current.indexOf(key);
    const nextIndex = index + direction;
    if (index === -1 || nextIndex < 0 || nextIndex >= current.length) {
      return;
    }
    const reordered = [...current];
    const moved = reordered.splice(index, 1)[0];
    reordered.splice(nextIndex, 0, moved);
    this.prefsStore().setOrder(reordered);
    this.focusRow = nextIndex;
    await this.render();
  },

  async toggleItem(disableKey) {
    this.prefsStore().toggleDisabled(disableKey);
    await this.render();
  },

  async render() {
    this.model = await this.collectModel();
    // Read once per render rather than per card: the store deserialises on
    // every get, and this screen lists every catalogue the household has.
    const rowLayouts = this.prefsStore().get().rowLayouts || {};
    this.model.items = this.model.items.map((item) => ({
      ...item,
      rowLayout: rowLayouts[item.key] || ""
    }));
    this.rowColumns = new Map();
    const itemsHtml = this.model.items
      .map((item, index) => {
        const cols = [];
        if (item.canMoveUp) {
          cols.push(0);
        }
        if (item.canMoveDown) {
          cols.push(1);
        }
        cols.push(2);
        cols.push(3);
        this.setRowColumns(index, cols);

        return `
        <article class="catalog-order-card">
          <div class="catalog-order-card-copy">
            <h2>${escapeHtml(item.catalogName)} - ${escapeHtml(toDisplayTypeLabel(item.type))}</h2>
            <p class="catalog-order-card-subtitle">${escapeHtml(item.addonName)}</p>
            ${item.isDisabled ? '<p class="catalog-order-card-disabled">Disabled on Home</p>' : ""}
          </div>
          <div class="catalog-order-card-actions">
            <button type="button"
                    class="catalog-order-action ${item.canMoveUp ? "catalog-order-focusable" : "is-disabled"}"
                    ${item.canMoveUp ? `data-row="${index}" data-col="0" data-action="up" data-key="${escapeHtml(item.key)}" tabindex="-1"` : 'tabindex="-1" aria-disabled="true"'}>
              <span class="material-icons" aria-hidden="true">arrow_upward</span>
            </button>
            <button type="button"
                    class="catalog-order-action ${item.canMoveDown ? "catalog-order-focusable" : "is-disabled"}"
                    ${item.canMoveDown ? `data-row="${index}" data-col="1" data-action="down" data-key="${escapeHtml(item.key)}" tabindex="-1"` : 'tabindex="-1" aria-disabled="true"'}>
              <span class="material-icons" aria-hidden="true">arrow_downward</span>
            </button>
            <button type="button"
                    class="catalog-order-action catalog-order-focusable catalog-order-toggle${item.isDisabled ? " is-disabled-state" : ""}"
                    data-row="${index}"
                    data-col="2"
                    data-action="toggle"
                    data-disable-key="${escapeHtml(item.disableKey)}"
                    tabindex="-1">${item.isDisabled ? "Enable" : "Disable"}</button>
            <button type="button"
                    class="catalog-order-action catalog-order-focusable catalog-order-layout"
                    data-row="${index}"
                    data-col="3"
                    data-action="layout"
                    data-key="${escapeHtml(item.key)}"
                    tabindex="-1"
                    title="${escapeHtml(t("catalog_order_layout_hint", {}, "Card shape for this row"))}">
              <span class="material-icons" aria-hidden="true">${
                item.rowLayout === "landscape" ? "crop_16_9" : "crop_portrait"
              }</span>
              <span class="catalog-order-layout-label">${escapeHtml(
                item.rowLayout === "landscape"
                  ? t("catalog_order_layout_landscape", {}, "Wide")
                  : item.rowLayout === "poster"
                    ? t("catalog_order_layout_poster", {}, "Poster")
                    : t("catalog_order_layout_default", {}, "Default")
              )}</span>
            </button>
          </div>
        </article>
      `;
      })
      .join("");

    this.container.innerHTML = `
      <div class="catalog-order-shell">
        <main class="catalog-order-main">
          <h1 class="catalog-order-title">${escapeHtml(
            this.scope
              ? t(
                  "tab.manageRowsFor",
                  { tab: homeTabTitle(this.scope) },
                  `Rows — ${homeTabTitle(this.scope)}`
                )
              : t("catalog_order_title", {}, "Organizar filas de Inicio")
          )}</h1>
          <p class="catalog-order-subtitle">This controls catalog row order on Home (Classic + Modern + Grid).</p>
          <section class="catalog-order-list">
            ${this.model.items.length ? itemsHtml : '<p class="catalog-order-empty">No home catalogs available yet.</p>'}
          </section>
        </main>
      </div>
    `;

    this.container.querySelectorAll(".catalog-order-focusable[data-action]").forEach((node) => {
      node.addEventListener("click", async () => {
        this.focusRow = Number(node.dataset.row || 0);
        this.focusCol = Number(node.dataset.col || 0);
        this.applyFocus();
        await this.activateFocused();
      });
    });

    this.normalizeFocus();
    this.applyFocus();
  },

  async activateFocused() {
    const current = this.container?.querySelector(".catalog-order-focusable.focused");
    if (!current) {
      return;
    }

    const action = String(current.dataset.action || "");
    if (action === "up") {
      await this.moveItem(String(current.dataset.key || ""), -1);
    } else if (action === "down") {
      await this.moveItem(String(current.dataset.key || ""), 1);
    } else if (action === "toggle") {
      await this.toggleItem(String(current.dataset.disableKey || ""));
    } else if (action === "layout") {
      await this.cycleRowLayout(String(current.dataset.key || ""));
    }
  },

  /**
   * Cycles a row between following the global setting, poster, and wide.
   *
   * Three states rather than two so a row can be handed back to the global
   * preference: with only poster/wide, flipping the app-wide setting would stop
   * moving any row that had ever been touched here.
   */
  async cycleRowLayout(rowKey = "") {
    const key = String(rowKey || "").trim();
    if (!key) {
      return;
    }
    const current = this.prefsStore().getRowLayout(key);
    const next = current === "" ? "poster" : current === "poster" ? "landscape" : "";
    this.prefsStore().setRowLayout(key, next);
    await this.render();
  },

  moveFocus(deltaRow, deltaCol = 0) {
    if (deltaCol !== 0) {
      const cols = this.getCols(this.focusRow);
      const currentIndex = Math.max(0, cols.indexOf(this.focusCol));
      this.focusCol = cols[clamp(currentIndex + deltaCol, 0, cols.length - 1)];
      this.applyFocus();
      return;
    }

    const rows = this.getRows();
    const currentIndex = Math.max(0, rows.indexOf(this.focusRow));
    this.focusRow = rows[clamp(currentIndex + deltaRow, 0, rows.length - 1)] || 0;
    const cols = this.getCols(this.focusRow);
    this.focusCol = cols.includes(this.focusCol) ? this.focusCol : cols[0];
    this.applyFocus();
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      await Router.back();
      return;
    }

    const code = Number(event?.keyCode || 0);
    if (code === 38 || code === 40 || code === 37 || code === 39) {
      event?.preventDefault?.();
      if (code === 38) this.moveFocus(-1);
      else if (code === 40) this.moveFocus(1);
      else if (code === 37) this.moveFocus(0, -1);
      else if (code === 39) this.moveFocus(0, 1);
      return;
    }

    if (code === 13) {
      // Prevent the focused button's native click from also firing, otherwise
      // the action runs twice and rows jump two slots at a time.
      event?.preventDefault?.();
      event?.stopPropagation?.();
      await this.activateFocused();
    }
  },

  cleanup() {
    ScreenUtils.hide(this.container);
  }
};
