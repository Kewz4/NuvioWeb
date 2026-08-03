// Composited artwork for the Smart Hub preview cards.
//
// Samsung draws the card chrome itself and gives us exactly one image URL, which
// its launcher fetches out of our process. There is no way to place a badge, a
// play button or a progress bar on the card — unless the image already has one
// burned into its pixels at a public URL.
//
// So the artwork is composed on a CDN. Each poster is ingested once by URL, and
// the badge, scrim and progress bar are applied as overlay transformations on
// the delivery URL. That means no canvas (the TV would taint it on cross-origin
// artwork), no per-render upload, and a URL that is cacheable forever because it
// is a pure function of its inputs.
//
// The overlay assets are pinned by UUID below. They are content addresses on a
// public CDN, not credentials.

const CDN_HOST = "https://2mwsm8te2k.ucarecd.net";
const UPLOAD_HOST = "https://upload.uploadcare.com";

// Samsung renders 16:9 preview tiles; this is the largest size worth sending.
export const CARD_WIDTH = 480;
export const CARD_HEIGHT = 270;

// Overlay dimensions are percentages of the card, so one asset serves every
// card size. `p` is Uploadcare's percent unit; dimensions separate with `x`,
// coordinates with a comma.
const SCRIM = { uuid: "c3ed7d64-bbe2-4914-8351-4224adbd5f5b", dims: "100px100p", at: "0p,0p" };
const PROGRESS_TRACK = { uuid: "b5a54b6d-8ebc-4fdb-a480-60dfa96ed1d7", at: "4p,88p" };
const PROGRESS_FILL = { uuid: "81edc0a7-aa38-4d2d-b1ed-2717f894c19a", at: "4p,88p" };
const PROGRESS_WIDTH_PERCENT = 92;

export const SMART_HUB_CARD_BADGES = Object.freeze({
  continueWatching: Object.freeze({
    uuid: "40567a83-8d43-49ea-a686-8b79a06b73f9",
    dims: "37px13p",
    // Sits higher than the others to leave room for the progress bar below it.
    at: "4p,64p"
  }),
  paraTi: Object.freeze({
    uuid: "b140891e-a0db-4a19-b2ca-bc54d104eb0c",
    dims: "26px13p",
    at: "4p,78p"
  }),
  top10: Object.freeze({
    uuid: "d8c210e7-4a3d-4218-8113-f392eda2c56e",
    dims: "17px13p",
    at: "4p,78p"
  })
});

function overlay({ uuid, dims, at }) {
  return `-/overlay/${uuid}/${dims}/${at}/`;
}

/**
 * Delivery URL for a composited card.
 *
 * @param {object} options
 * @param {string} options.artworkUuid  from {@link ingestCardArtwork}
 * @param {object} [options.badge]      one of SMART_HUB_CARD_BADGES
 * @param {number|null} [options.progressPercent] draws a resume bar when set
 * @returns {string} "" when there is no artwork to build on
 */
export function buildCardArtworkUrl({
  artworkUuid = "",
  badge = null,
  progressPercent = null
} = {}) {
  const uuid = String(artworkUuid || "").trim();
  if (!uuid) {
    return "";
  }
  let url = `${CDN_HOST}/${uuid}/-/preview/${CARD_WIDTH}x${CARD_HEIGHT}/`;
  url += overlay(SCRIM);
  if (badge?.uuid) {
    url += overlay(badge);
  }

  const percent = Number(progressPercent);
  if (Number.isFinite(percent) && percent > 0) {
    const clamped = Math.max(1, Math.min(100, Math.round(percent)));
    const fillWidth = Math.max(1, Math.round((clamped / 100) * PROGRESS_WIDTH_PERCENT));
    url += overlay({ ...PROGRESS_TRACK, dims: `${PROGRESS_WIDTH_PERCENT}px4p` });
    url += overlay({ ...PROGRESS_FILL, dims: `${fillWidth}px4p` });
  }
  // A filename is appended so the URL ends in .jpg: Samsung's preview only
  // accepts image URLs with a recognised extension.
  return `${url}card.jpg`;
}

/**
 * Ingests a remote poster so it can be transformed, returning its CDN uuid.
 *
 * Uses upload-from-URL rather than uploading bytes: the TV never has to fetch,
 * decode or re-encode the poster, and the whole operation is two small JSON
 * requests. Only the public key is involved, which is designed to ship in
 * client code.
 *
 * @returns {Promise<string>} the uuid, or "" if it could not be ingested
 */
export async function ingestCardArtwork(sourceUrl, options = {}) {
  const {
    publicKey = "",
    fetchImpl = typeof fetch === "function" ? fetch : null,
    pollIntervalMs = 800,
    maxPolls = 12
  } = options;
  const source = String(sourceUrl || "").trim();
  if (!source || !publicKey || !fetchImpl) {
    return "";
  }

  try {
    const start = new URL(`${UPLOAD_HOST}/from_url/`);
    start.searchParams.set("pub_key", publicKey);
    start.searchParams.set("source_url", source);
    start.searchParams.set("store", "1");
    const started = await (await fetchImpl(start.toString())).json();
    // An already-ingested source comes back as the file record directly.
    if (started?.uuid) {
      return String(started.uuid);
    }
    if (!started?.token) {
      return "";
    }

    for (let poll = 0; poll < maxPolls; poll += 1) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const status = await (
        await fetchImpl(`${UPLOAD_HOST}/from_url/status/?token=${started.token}`)
      ).json();
      if (status?.status === "success" && status.uuid) {
        return String(status.uuid);
      }
      if (status?.status === "error") {
        return "";
      }
    }
  } catch (_) {
    // The card simply falls back to its unbadged artwork.
  }
  return "";
}
