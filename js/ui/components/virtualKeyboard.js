// An in-app on-screen keyboard for the TV.
//
// Samsung's own IME is avoided deliberately. It cannot be extended — there is no
// web API to put search suggestions into its strip, it ignores <datalist>, and
// it covers most of the screen with a layout tuned for typing URLs. Owning the
// keyboard means the suggestions sit right where the eye already is, the keys
// are as large as this screen allows, and the whole thing follows the same
// D-pad model as every other rail in the app.
//
// QWERTY, with the digits on their own row and everything else — accents,
// punctuation, currency — moved to a second layer behind one toggle. Mixing
// symbols into the letter grid is what makes most TV keyboards a maze: the key
// you want is never where muscle memory says it is, and the row you are on
// changes width as you move down it. Here every letter row is ten keys wide and
// sits exactly where a phone keyboard would put it.

const LETTER_LAYERS = {
  letters: [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L", "Ñ"],
    ["Z", "X", "C", "V", "B", "N", "M", "Á", "É", "Í"]
  ],
  symbols: [
    ["Ó", "Ú", "Ü", "¿", "?", "¡", "!", "@", "#", "&"],
    ["%", "+", "-", "=", "(", ")", "[", "]", "{", "}"],
    [".", ",", ":", ";", "'", '"', "/", "\\", "_", "|"],
    ["$", "€", "£", "*", "^", "~", "<", ">", "°", "·"]
  ]
};

// Wider keys that do something other than insert a character. `span` is the
// flex weight, so the row always fills its width whatever the labels are.
const ACTIONS = [
  { id: "shift", label: "Mayús", span: 2 },
  { id: "layer", label: "#+=", span: 2 },
  { id: "space", label: "Espacio", span: 4 },
  { id: "backspace", label: "⌫", span: 2 },
  { id: "clear", label: "Borrar", span: 2 },
  { id: "done", label: "Listo", span: 3, primary: true }
];

const SUGGESTION_ROW = -1;

function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char
  );
}

/**
 * Creates a keyboard bound to a container.
 *
 * The caller owns key routing: this app dispatches remote input to
 * `screen.onKeyDown`, so the keyboard exposes `handleKeyDown` and reports
 * whether it consumed the press rather than listening globally.
 *
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {string} [options.value] initial text
 * @param {function} [options.onChange] (text) => void, fires per edit
 * @param {function} [options.onSubmit] (text) => void, Done or a suggestion
 * @param {function} [options.onCancel] () => void, Back on an empty field
 * @returns {object} keyboard handle
 */
export function createVirtualKeyboard({
  container,
  value = "",
  placeholder = "",
  onChange = () => {},
  onSubmit = () => {},
  onCancel = () => {}
} = {}) {
  let text = String(value || "");
  let suggestions = [];
  let layer = "letters";
  // Starts on, because the first character of a title usually is a capital and
  // typing one letter is a worse default than turning it off once.
  let shift = true;
  let row = 0;
  let col = 0;

  /** A key as it should read and insert right now. */
  const cased = (key) => (shift ? key : key.toLowerCase());

  const keys = () => LETTER_LAYERS[layer];
  const rowsCount = () => keys().length + 1; // + the action row
  const colsInRow = (index) =>
    index === SUGGESTION_ROW
      ? Math.max(1, suggestions.length)
      : index < keys().length
        ? keys()[index].length
        : ACTIONS.length;

  function clampCursor() {
    if (row === SUGGESTION_ROW && !suggestions.length) {
      row = 0;
    }
    const max = colsInRow(row) - 1;
    col = Math.max(0, Math.min(max, col));
  }

  function render() {
    if (!container) {
      return;
    }
    const suggestionMarkup = suggestions.length
      ? `<div class="vk-suggestions" data-vk-row="${SUGGESTION_ROW}">
           ${suggestions
             .map(
               (item, index) => `
             <button class="vk-suggestion${row === SUGGESTION_ROW && col === index ? " focused" : ""}"
                     data-vk-row="${SUGGESTION_ROW}" data-vk-col="${index}">
               ${escapeHtml(item)}
             </button>`
             )
             .join("")}
         </div>`
      : "";

    const keyRows = keys()
      .map(
        (keys, rowIndex) => `
      <div class="vk-row">
        ${keys
          .map(
            (key, colIndex) => `
          <button class="vk-key${row === rowIndex && col === colIndex ? " focused" : ""}"
                  data-vk-row="${rowIndex}" data-vk-col="${colIndex}">${escapeHtml(cased(key))}</button>`
          )
          .join("")}
      </div>`
      )
      .join("");

    const actionRow = `
      <div class="vk-row vk-actions">
        ${ACTIONS.map(
          (action, index) => `
          <button class="vk-key vk-action${action.primary ? " primary" : ""}${
            action.id === "shift" && shift ? " active" : ""
          }${row === keys().length && col === index ? " focused" : ""}"
                  style="flex-grow:${action.span}"
                  data-vk-row="${keys().length}" data-vk-col="${index}">${escapeHtml(
                    action.id === "layer" ? (layer === "letters" ? "#+=" : "ABC") : action.label
                  )}</button>`
        ).join("")}
      </div>`;

    container.innerHTML = `
      <div class="vk-root">
        <div class="vk-field">
          ${
            text
              ? `<span class="vk-text">${escapeHtml(text)}</span><span class="vk-caret"></span>`
              : `<span class="vk-placeholder">${escapeHtml(placeholder)}</span>`
          }
        </div>
        ${suggestionMarkup}
        <div class="vk-keys">${keyRows}${actionRow}</div>
      </div>
    `;
  }

  function setText(next) {
    text = next;
    render();
    onChange(text);
  }

  function activate() {
    if (row === SUGGESTION_ROW) {
      const picked = suggestions[col];
      if (picked) {
        text = picked;
        render();
        onChange(text);
        onSubmit(text);
      }
      return;
    }
    if (row < keys().length) {
      setText(text + cased(keys()[row][col]));
      return;
    }
    const action = ACTIONS[col];
    if (!action) {
      return;
    }
    if (action.id === "shift") {
      shift = !shift;
      render();
    } else if (action.id === "layer") {
      layer = layer === "letters" ? "symbols" : "letters";
      clampCursor();
      render();
    } else if (action.id === "space") {
      setText(`${text} `);
    } else if (action.id === "backspace") {
      setText(text.slice(0, -1));
    } else if (action.id === "clear") {
      setText("");
    } else if (action.id === "done") {
      onSubmit(text);
    }
  }

  return {
    render,

    getValue() {
      return text;
    },

    setSuggestions(next = []) {
      suggestions = (Array.isArray(next) ? next : []).filter(Boolean).slice(0, 5);
      clampCursor();
      render();
    },

    /**
     * @returns {boolean} true when the press was consumed by the keyboard.
     */
    handleKeyDown(event, { isBack = false } = {}) {
      const key = String(event?.key || "");
      const code = Number(event?.keyCode || 0);
      const up = code === 38 || key === "ArrowUp";
      const down = code === 40 || key === "ArrowDown";
      const left = code === 37 || key === "ArrowLeft";
      const right = code === 39 || key === "ArrowRight";
      const enter = code === 13 || key === "Enter";

      if (isBack) {
        // Back deletes while there is something to delete, so a mistyped letter
        // costs one press rather than a trip to the ⌫ key.
        if (text) {
          setText(text.slice(0, -1));
        } else {
          onCancel();
        }
        return true;
      }

      if (up || down) {
        const first = suggestions.length ? SUGGESTION_ROW : 0;
        const next = row + (down ? 1 : -1);
        row = Math.max(first, Math.min(rowsCount() - 1, next));
        clampCursor();
        render();
        return true;
      }
      if (left || right) {
        const max = colsInRow(row) - 1;
        col = Math.max(0, Math.min(max, col + (right ? 1 : -1)));
        render();
        return true;
      }
      if (enter) {
        activate();
        return true;
      }
      return false;
    },

    /** Wires pointer clicks, for the browser and for a connected mouse. */
    bindPointer() {
      container?.addEventListener("click", (event) => {
        const target = event.target.closest?.("[data-vk-row]");
        if (!target) {
          return;
        }
        row = Number(target.dataset.vkRow);
        col = Number(target.dataset.vkCol);
        activate();
      });
    }
  };
}
