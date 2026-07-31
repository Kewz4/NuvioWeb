/* global module, tizen, webapis */
"use strict";

var SERVICE_TAG = "[Nuvio Smart Hub Preview]";
var PENDING_SNAPSHOT_FILE = "smart-hub-preview.pending.json";
var SNAPSHOT_FILE = "smart-hub-preview.last-good.json";
var TIMESTAMP_FILE = "smart-hub-preview-timestamp.json";
var PRIVATE_DIR = "wgt-private";
var MIN_UPDATE_INTERVAL_MS = 10 * 60 * 1000;
var FALLBACK_PREVIEW_DATA = {
  sections: [
    {
      title: "Nuvio TV",
      title_display_mode: "AlwaysOn",
      tiles: [
        {
          title: "Studios",
          subtitle: "Explorar Marvel",
          image_ratio: "16by9",
          image_url:
            "https://raw.githubusercontent.com/Kewz4/NuvioWeb/main/assets/smart-hub-preview/studios-marvel.jpg",
          action_data:
            '{"nuvioPreview":1,"kind":"collection-folder","source":"fallback","collectionId":"b9a327ea-1e13-47d7-a623-0324f08dac6b","folderId":"52e31de1-783d-4e6e-b388-8b67c30465ba","collectionTitle":"Studios","title":"Marvel"}',
          is_playable: false
        },
        {
          title: "Streaming",
          subtitle: "Explorar Netflix",
          image_ratio: "16by9",
          image_url:
            "https://raw.githubusercontent.com/Kewz4/NuvioWeb/main/assets/smart-hub-preview/streaming-netflix.jpg",
          action_data:
            '{"nuvioPreview":1,"kind":"collection-folder","source":"fallback","collectionId":"5bcee819-c48e-4d74-b740-f43c24281a87","folderId":"ec4fd26a-ecee-48f1-9be2-a8d5f5eb2821","collectionTitle":"Streaming","title":"Netflix"}',
          is_playable: false
        }
      ]
    }
  ]
};

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
  return resolvePrivateDir().then(function (dir) {
    return Promise.all([
      readFile(dir, PENDING_SNAPSHOT_FILE),
      readFile(dir, SNAPSHOT_FILE),
      readFile(dir, TIMESTAMP_FILE)
    ]).then(function (values) {
      var pending = parseJson(values[0], null);
      var lastGood = parseJson(values[1], null);
      var previewData = isValidPreviewData(pending)
        ? pending
        : isValidPreviewData(lastGood)
          ? lastGood
          : FALLBACK_PREVIEW_DATA;
      var shouldPromote = isValidPreviewData(pending);
      var timestamp = parseJson(values[2], { updatedAt: 0 });
      var lastUpdated = Number(timestamp && timestamp.updatedAt ? timestamp.updatedAt : 0);
      if (Date.now() - lastUpdated < MIN_UPDATE_INTERVAL_MS) {
        log("preview snapshot retained; Samsung update interval still active");
        return false;
      }
      return setPreviewData(previewData, dir).then(function (updated) {
        if (!updated || !shouldPromote) {
          return updated;
        }
        return writeFile(dir, SNAPSHOT_FILE, JSON.stringify(previewData))
          .then(function () {
            return true;
          })
          .catch(function (error) {
            warn("last-good snapshot save failed", error);
            return true;
          });
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
