const STREAMING_LIBS = [
  {
    sources: [
      "assets/libs/hls.min.js",
      "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js"
    ],
    isLoaded: () => Boolean(globalThis.Hls)
  },
  {
    sources: [
      "assets/libs/dash.all.min.js",
      "https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js"
    ],
    isLoaded: () => Boolean(globalThis.dashjs)
  }
];

let streamingLibsPromise = null;
let streamingLibsWarmupScheduled = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = (error) => {
      script.remove();
      reject(error);
    };
    document.head.appendChild(script);
  });
}

async function loadStreamingLibrary(entry) {
  let lastError = null;
  for (const src of entry.sources) {
    try {
      await loadScript(src);
      if (entry.isLoaded()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Streaming library failed to initialize");
}

export async function loadStreamingLibs() {
  if (STREAMING_LIBS.every((entry) => entry.isLoaded())) {
    return;
  }
  if (streamingLibsPromise) {
    return streamingLibsPromise;
  }
  streamingLibsPromise = (async () => {
    for (const entry of STREAMING_LIBS) {
      if (entry.isLoaded()) {
        continue;
      }
      try {
        await loadStreamingLibrary(entry);
      } catch (error) {
        console.warn("Streaming library failed to load", entry.sources, error);
      }
    }
  })();
  try {
    await streamingLibsPromise;
  } finally {
    streamingLibsPromise = null;
  }
}

/**
 * Whether this device plays through a native pipeline rather than these
 * libraries.
 *
 * Tizen and webOS hand playback to AVPlay, which decodes HLS and DASH itself.
 * hls.js and dash.js are together about 1.2 MB to download, parse and execute,
 * and on a TV that money buys nothing — the engine picker only reaches for them
 * when AVPlay has already been ruled out, which is rare and can afford to wait
 * for the load at that point. So the warm-up is skipped here entirely; the
 * on-demand path in ensureAdaptiveLibrariesForSource still covers the fallback.
 */
function playsThroughNativePipeline() {
  const root = globalThis;
  if (root.__NUVIO_PLATFORM__ === "tizen" || root.__NUVIO_PLATFORM__ === "webos") {
    return true;
  }
  const webapis = root.webapis || {};
  return Boolean(root.tizen || root.avplay || webapis.avplay || webapis.avPlay || root.webOS);
}

export function warmStreamingLibs(options = {}) {
  if (streamingLibsWarmupScheduled || STREAMING_LIBS.every((entry) => entry.isLoaded())) {
    return;
  }
  if (playsThroughNativePipeline()) {
    return;
  }
  streamingLibsWarmupScheduled = true;
  const delayMs = Math.max(0, Number(options?.delayMs || 1200));
  const startWarmup = () => {
    streamingLibsWarmupScheduled = false;
    void loadStreamingLibs();
  };
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(startWarmup, { timeout: Math.max(2000, delayMs + 1200) });
    return;
  }
  setTimeout(startWarmup, delayMs);
}
