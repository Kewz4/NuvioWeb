// Remote control for the Electron test harness.
//
// The Electron window is launched separately with --remote-debugging-port, so
// this script connects over CDP for each command and leaves the app running.
// That gives stateless invocations against a persistent, real app instance —
// crucially with REAL keyboard events, which the app's D-pad focus model needs.
//
// Usage:
//   node scripts/rc.mjs key ArrowDown [count]
//   node scripts/rc.mjs click <x> <y>
//   node scripts/rc.mjs eval "<expression>"
//   node scripts/rc.mjs text
//   node scripts/rc.mjs shot <path>
//   node scripts/rc.mjs focus
//   node scripts/rc.mjs state

import { chromium } from "playwright";

const CDP_URL = process.env.NUVIO_CDP || "http://localhost:9222";
const [, , command, ...args] = process.argv;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const browser = await chromium.connectOverCDP(CDP_URL).catch((error) => {
  fail(`Cannot reach Electron on ${CDP_URL}. Is the harness running?\n${error.message}`);
});

const contexts = browser.contexts();
const pages = contexts.flatMap((context) => context.pages());
// Ignore devtools targets; the app is the one serving the dev server URL.
const page = pages.find((p) => /localhost:4173/.test(p.url())) || pages[0];
if (!page) {
  fail("No Electron page found.");
}

const SCREEN_STATE = `(() => {
  const shown = Array.from(document.querySelectorAll('.screen'))
    .filter((n) => getComputedStyle(n).display !== 'none')
    .map((n) => n.id);
  const focused = document.querySelector('.focusable.focused');
  const video = document.getElementById('videoPlayer');
  return {
    screen: shown,
    focused: (focused?.innerText || '').replace(/\\n+/g, ' | ').trim().slice(0, 80),
    focusedAction: focused?.dataset?.action || null,
    video: video
      ? {
          readyState: video.readyState,
          t: Number(video.currentTime.toFixed(1)),
          paused: video.paused,
          w: video.videoWidth,
          h: video.videoHeight
        }
      : null
  };
})()`;

try {
  switch (command) {
    case "key": {
      const key = args[0];
      const count = Number(args[1] || 1);
      if (!key) fail("usage: rc.mjs key <Key> [count]");
      for (let i = 0; i < count; i += 1) {
        await page.keyboard.press(key);
        await page.waitForTimeout(220);
      }
      console.log(JSON.stringify(await page.evaluate(SCREEN_STATE), null, 2));
      break;
    }
    case "click": {
      const x = Number(args[0]);
      const y = Number(args[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) fail("usage: rc.mjs click <x> <y>");
      await page.mouse.click(x, y);
      await page.waitForTimeout(600);
      console.log(JSON.stringify(await page.evaluate(SCREEN_STATE), null, 2));
      break;
    }
    case "keys": {
      // A whole navigation in one connection. Player controls auto-hide after a
      // few seconds, so separate invocations lose the focus position between
      // presses; this keeps the sequence inside a single session.
      const sequence = args
        .join(" ")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      if (!sequence.length) fail("usage: rc.mjs keys ArrowDown,ArrowRight,Enter");
      for (const key of sequence) {
        const [name, repeat] = key.split("*");
        for (let i = 0; i < Number(repeat || 1); i += 1) {
          await page.keyboard.press(name.trim());
          await page.waitForTimeout(320);
        }
      }
      await page.waitForTimeout(1200);
      console.log(JSON.stringify(await page.evaluate(SCREEN_STATE), null, 2));
      break;
    }
    case "type": {
      // Real per-character key events. Setting input.value directly does not
      // fire the listeners the search screen relies on.
      const text = args.join(" ");
      if (!text) fail("usage: rc.mjs type <text>");
      await page.keyboard.type(text, { delay: 90 });
      await page.waitForTimeout(2500);
      console.log(JSON.stringify(await page.evaluate(SCREEN_STATE), null, 2));
      break;
    }
    case "click-sel": {
      // Clicks by CSS selector. Playwright scrolls the element into view and
      // dispatches a trusted click, which sidesteps the window zoom factor that
      // makes raw coordinates unreliable.
      const selector = args.join(" ");
      if (!selector) fail("usage: rc.mjs click-sel <css selector>");
      await page.click(selector, { timeout: 15000 });
      await page.waitForTimeout(1500);
      console.log(JSON.stringify(await page.evaluate(SCREEN_STATE), null, 2));
      break;
    }
    case "eval": {
      const expression = args.join(" ");
      if (!expression) fail("usage: rc.mjs eval <expression>");
      const result = await page.evaluate(expression);
      console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
      break;
    }
    case "text": {
      const text = await page.evaluate(
        `document.body.innerText.split('\\n').map(s => s.trim()).filter(Boolean).slice(0, 60).join('\\n')`
      );
      console.log(text);
      break;
    }
    case "shot": {
      const target = args[0] || "rc-shot.png";
      await page.screenshot({ path: target });
      console.log(`saved ${target}`);
      break;
    }
    case "import-storage": {
      // Copies a localStorage snapshot (from the browser preview) into the
      // Electron profile so the harness runs against the real signed-in state.
      const file = args[0];
      if (!file) fail("usage: rc.mjs import-storage <file.json>");
      const { readFile } = await import("node:fs/promises");
      const payload = JSON.parse(await readFile(file, "utf8"));
      const count = await page.evaluate((entries) => {
        Object.entries(entries).forEach(([key, value]) => {
          try {
            localStorage.setItem(key, value);
          } catch (_) {
            // Skip anything that will not fit; the rest still applies.
          }
        });
        return Object.keys(entries).length;
      }, payload);
      await page.reload();
      await page.waitForTimeout(6000);
      console.log(`imported ${count} keys`);
      console.log(JSON.stringify(await page.evaluate(SCREEN_STATE), null, 2));
      break;
    }
    case "focus":
    case "state": {
      console.log(JSON.stringify(await page.evaluate(SCREEN_STATE), null, 2));
      break;
    }
    default:
      fail(
        "commands: key <Key> [count] | click <x> <y> | eval <expr> | text | shot <path> | state"
      );
  }
} finally {
  // Detach WITHOUT closing: browser.close() on a CDP connection can terminate
  // the Electron app we are attached to, which would kill the harness after a
  // single command. Exiting the process drops the socket on its own.
  process.exit(0);
}
