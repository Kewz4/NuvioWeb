/* global module, tizen, webapis */
"use strict";

var SERVICE_TAG = "[Nuvio Smart Hub Preview]";
var SNAPSHOT_FILE = "smart-hub-preview.json";
var TIMESTAMP_FILE = "smart-hub-preview-timestamp.json";
var PRIVATE_DIR = "wgt-private";
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
    var requested = tizen.application.getCurrentApplication().getRequestedAppControl();
    var data = requested && requested.appControl && requested.appControl.data;
    if (!Array.isArray(data)) {
      return null;
    }
    for (var index = 0; index < data.length; index += 1) {
      if (String(data[index].key || "") !== "previewData") {
        continue;
      }
      var value = data[index].value && data[index].value[0];
      var parsed = parseJson(value, null);
      if (parsed && Array.isArray(parsed.sections) && parsed.sections.length) {
        return parsed;
      }
    }
  } catch (error) {
    warn("incoming preview read failed", error);
  }
  return null;
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
    var saveIncoming = incoming
      ? writeFile(dir, SNAPSHOT_FILE, JSON.stringify(incoming)).catch(function (error) {
          warn("snapshot save failed", error);
        })
      : Promise.resolve();
    return saveIncoming.then(function () {
      return Promise.all([
        incoming ? Promise.resolve(JSON.stringify(incoming)) : readFile(dir, SNAPSHOT_FILE),
        readFile(dir, TIMESTAMP_FILE)
      ]).then(function (values) {
        var previewData = parseJson(values[0], null);
        var timestamp = parseJson(values[1], { updatedAt: 0 });
        var lastUpdated = Number(timestamp && timestamp.updatedAt ? timestamp.updatedAt : 0);
        if (!previewData || !Array.isArray(previewData.sections) || !previewData.sections.length) {
          log("no saved preview data yet");
          return false;
        }
        if (Date.now() - lastUpdated < MIN_UPDATE_INTERVAL_MS) {
          log("preview snapshot saved; Samsung update interval still active");
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
