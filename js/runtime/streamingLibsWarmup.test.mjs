import assert from "node:assert/strict";
import test from "node:test";

// warmStreamingLibs reads platform globals and appends <script> nodes, so the
// test gives it just enough of a document to observe what it would load.
function withEnvironment(globals, run) {
  const appended = [];
  const previous = {
    document: globalThis.document,
    tizen: globalThis.tizen,
    avplay: globalThis.avplay,
    webapis: globalThis.webapis,
    webOS: globalThis.webOS,
    Hls: globalThis.Hls,
    dashjs: globalThis.dashjs,
    __NUVIO_PLATFORM__: globalThis.__NUVIO_PLATFORM__,
    requestIdleCallback: globalThis.requestIdleCallback
  };
  Object.keys(previous).forEach((key) => delete globalThis[key]);

  globalThis.document = {
    head: { appendChild: (node) => appended.push(node.src) },
    createElement: () => ({
      set src(value) {
        this._src = value;
      },
      get src() {
        return this._src;
      }
    })
  };
  // Fire the warm-up immediately rather than on an idle callback.
  globalThis.requestIdleCallback = (fn) => fn();
  Object.assign(globalThis, globals);

  try {
    run();
  } finally {
    Object.keys(globals).forEach((key) => delete globalThis[key]);
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) {
        delete globalThis[key];
      } else {
        globalThis[key] = value;
      }
    });
  }
  return appended;
}

const { warmStreamingLibs } = await import("./loadStreamingLibs.js");

test("a TV never downloads the adaptive libraries up front", () => {
  // AVPlay decodes HLS and DASH itself, so about 1.2 MB of download, parse and
  // execute would buy the TV nothing at all.
  ["tizen", "webos"].forEach((platform) => {
    const loaded = withEnvironment({ __NUVIO_PLATFORM__: platform }, () => warmStreamingLibs());
    assert.deepEqual(loaded, [], platform);
  });
});

test("the native pipeline is detected from its globals, not only the platform flag", () => {
  // A wrapper that boots without setting __NUVIO_PLATFORM__ must still be
  // recognised, or the TV quietly pays the cost again.
  [{ tizen: {} }, { avplay: {} }, { webapis: { avplay: {} } }, { webOS: {} }].forEach((globals) => {
    const loaded = withEnvironment(globals, () => warmStreamingLibs());
    assert.deepEqual(loaded, [], JSON.stringify(Object.keys(globals)));
  });
});

test("a browser still warms them, because it has no other way to play", () => {
  const loaded = withEnvironment({}, () => warmStreamingLibs());
  assert.ok(
    loaded.some((src) => src.includes("hls")),
    "expected hls.js to be warmed on a plain browser"
  );
});
