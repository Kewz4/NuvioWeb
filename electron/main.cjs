// Electron shell used as a TV-accurate test harness for the web app.
//
// The Tizen build renders into a fixed 1920x1080 canvas, so this window matches
// that exactly (with a scale factor for smaller monitors). Running the real
// bundle here lets Playwright drive genuine keyboard input, which is the only
// way to exercise the player's D-pad focus model outside the TV.

const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");

const APP_URL = process.env.NUVIO_APP_URL || "http://localhost:4173";
// Zoom keeps the 1920x1080 layout intact while fitting a normal monitor.
const ZOOM = Number(process.env.NUVIO_ZOOM || 0.6);

function createWindow() {
  const win = new BrowserWindow({
    width: Math.round(1920 * ZOOM),
    height: Math.round(1080 * ZOOM) + 24,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      // The app is first-party and needs to reach addon/stream hosts directly,
      // exactly as it does on the TV.
      webSecurity: false,
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.webContents.on("did-finish-load", () => {
    win.webContents.setZoomFactor(ZOOM);
  });

  // The dev server is often still starting when the harness launches, so retry
  // rather than leaving a blank error page that needs a manual reload.
  let retries = 0;
  win.webContents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
    if (!isMainFrame || retries >= 30) {
      return;
    }
    retries += 1;
    console.log(`load failed (${description}); retry ${retries} in 1s -> ${url}`);
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.loadURL(APP_URL);
      }
    }, 1000);
  });

  win.loadURL(APP_URL);
  return win;
}

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors,CrossOriginOpenerPolicy");

app.whenReady().then(() => {
  // Strip CORS restrictions the same way the TV runtime does, so addon and
  // subtitle hosts behave identically here.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Access-Control-Allow-Origin": ["*"]
      }
    });
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
