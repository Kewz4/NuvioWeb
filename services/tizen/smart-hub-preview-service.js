/* global module, tizen, webapis */
"use strict";

var SERVICE_TAG = "[Nuvio Smart Hub Preview]";
var PENDING_SNAPSHOT_FILE = "smart-hub-preview.pending.json";
var SNAPSHOT_FILE = "smart-hub-preview.last-good.json";
var TIMESTAMP_FILE = "smart-hub-preview-timestamp.json";
var PRIVATE_DIR = "wgt-private";
var PREVIEW_APP_CONTROL_DATA_KEY = "previewData";
var MIN_UPDATE_INTERVAL_MS = 10 * 60 * 1000;

function log() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift(SERVICE_TAG);
  console.log.apply(console, args);
}

function warn() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift(SERVICE_TAG);
  console.warn.apply(console, args);
}

function exitService() {
  try {
    tizen.application.getCurrentApplication().exit();
  } catch (error) {
    warn("exit failed", error);
  }
}

function resolvePrivateDir() {
  return new Promise(function (resolve, reject) {
    tizen.filesystem.resolve(PRIVATE_DIR, resolve, reject, "rw");
  });
}

function readFile(dir, fileName) {
  return new Promise(function (resolve) {
    var file;
    try {
      file = dir.resolve(fileName);
    } catch (_) {
      resolve("");
      return;
    }
    file.openStream(
      "r",
      function (stream) {
        var contents = "";
        try {
          if (stream.bytesAvailable > 0) {
            contents = stream.read(stream.bytesAvailable);
          }
        } catch (_) {}
        stream.close();
        resolve(contents);
      },
      function () {
        resolve("");
      }
    );
  });
}

function writeFile(dir, fileName, contents) {
  return new Promise(function (resolve, reject) {
    var file;
    try {
      file = dir.resolve(fileName);
    } catch (_) {
      try {
        file = dir.createFile(fileName);
      } catch (error) {
        reject(error);
        return;
      }
    }
    file.openStream(
      "w",
      function (stream) {
        try {
          stream.write(String(contents || ""));
          stream.close();
          resolve(true);
        } catch (error) {
          try {
            stream.close();
          } catch (_) {}
          reject(error);
        }
      },
      reject
    );
  });
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch (_) {
    return fallback;
  }
}

function findIncomingPreviewData() {
  try {
    var requestedAppControl = tizen.application.getCurrentApplication().getRequestedAppControl();
    var data =
      requestedAppControl && requestedAppControl.appControl
        ? requestedAppControl.appControl.data
        : null;
    if (!Array.isArray(data)) {
      return null;
    }
    for (var index = 0; index < data.length; index += 1) {
      var entry = data[index];
      if (String(entry && entry.key ? entry.key : "") !== PREVIEW_APP_CONTROL_DATA_KEY) {
        continue;
      }
      var chunks = entry && Array.isArray(entry.value) ? entry.value : [];
      return parseJson(chunks.join(""), null);
    }
  } catch (error) {
    warn("incoming preview read failed", error);
  }
  return null;
}

function isValidPreviewData(value) {
  if (!value || !Array.isArray(value.sections) || !value.sections.length) {
    return false;
  }
  var tileCount = 0;
  for (var sectionIndex = 0; sectionIndex < value.sections.length; sectionIndex += 1) {
    var tiles = value.sections[sectionIndex] && value.sections[sectionIndex].tiles;
    if (!Array.isArray(tiles) || !tiles.length) {
      return false;
    }
    tileCount += tiles.length;
  }
  return tileCount > 0 && tileCount <= 40;
}

function setPreviewData(previewData, dir) {
  return new Promise(function (resolve) {
    try {
      webapis.preview.setPreviewData(
        JSON.stringify(previewData),
        function () {
          writeFile(dir, TIMESTAMP_FILE, JSON.stringify({ updatedAt: Date.now() }))
            .catch(function (error) {
              warn("timestamp save failed", error);
            })
            .then(function () {
              log("preview updated", previewData.sections.length);
              resolve(true);
            });
        },
        function (error) {
          warn("setPreviewData failed", error && error.message ? error.message : error);
          resolve(false);
        }
      );
    } catch (error) {
      warn("setPreviewData threw", error);
      resolve(false);
    }
  });
}

function updatePreview() {
  var incoming = findIncomingPreviewData();
  return resolvePrivateDir().then(function (dir) {
    return Promise.all([
      readFile(dir, PENDING_SNAPSHOT_FILE),
      readFile(dir, SNAPSHOT_FILE),
      readFile(dir, TIMESTAMP_FILE)
    ]).then(function (values) {
      var storedPending = parseJson(values[0], null);
      var pending = isValidPreviewData(incoming) ? incoming : storedPending;
      var lastGood = parseJson(values[1], null);
      var previewData = isValidPreviewData(pending)
        ? pending
        : isValidPreviewData(lastGood)
          ? lastGood
          : null;
      var shouldPromote = isValidPreviewData(pending);
      var timestamp = parseJson(values[2], { updatedAt: 0 });
      var lastUpdated = Number(timestamp && timestamp.updatedAt ? timestamp.updatedAt : 0);
      if (!previewData) {
        log("no personalized snapshot available; leaving the existing preview unchanged");
        return false;
      }

      var persistSnapshot = shouldPromote
        ? Promise.all([
            writeFile(dir, PENDING_SNAPSHOT_FILE, JSON.stringify(previewData)),
            writeFile(dir, SNAPSHOT_FILE, JSON.stringify(previewData))
          ]).catch(function (error) {
            warn("personalized snapshot save failed", error);
          })
        : Promise.resolve();

      return persistSnapshot.then(function () {
        if (Date.now() - lastUpdated < MIN_UPDATE_INTERVAL_MS) {
          log("preview snapshot retained; Samsung update interval still active");
          return false;
        }
        return setPreviewData(previewData, dir);
      });
    });
  });
}

function run() {
  updatePreview()
    .catch(function (error) {
      warn("preview update failed", error);
    })
    .then(exitService);
}

module.exports.onStart = function () {
  log("service started");
};

module.exports.onRequest = function () {
  run();
};

module.exports.onExit = function () {
  log("service exited");
};

module.exports.onStop = module.exports.onExit;
