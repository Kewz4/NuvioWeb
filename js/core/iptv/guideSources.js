// Shared XMLTV guides shipped with this build.
//
// The iptv-org playlists carry no `url-tvg` header and iptv-org's own EPG
// project is self-hosted only, so without these the Live TV tab shows "Sin
// guía" on every row. These are public, prebuilt, plain-XML guides covering the
// regions the shipped playlists come from; channels are matched to them by name
// (see channelMatch.js), not by id, because no two projects agree on ids.
//
// Plain `.xml` is required, not `.xml.gz`: the TV's engine will not transparently
// decompress an `application/octet-stream` body, and shipping an inflate
// implementation to save a few hundred kilobytes is not a trade worth making.
//
// `region` is only a label for logs and settings; every guide is matched against
// every channel, since Spanish-language playlists mix countries freely.
//
// Order matters twice over: an earlier feed wins an ambiguous name match, and
// each feed only has to look at what is still unmatched, so the ones measured to
// yield the most matches per megabyte come first. The tail feeds add a handful
// of channels each and cost little because so little is left to match by then.

export const DEFAULT_GUIDE_SOURCES = [
  { id: "guide-mx", region: "MX", url: "https://open-epg.com/files/mexico1.xml" },
  { id: "guide-mx2", region: "MX", url: "https://open-epg.com/files/mexico2.xml" },
  { id: "guide-es", region: "ES", url: "https://open-epg.com/files/spain1.xml" },
  { id: "guide-cl", region: "CL", url: "https://open-epg.com/files/chile1.xml" },
  { id: "guide-co", region: "CO", url: "https://open-epg.com/files/colombia1.xml" },
  { id: "guide-ar", region: "AR", url: "https://open-epg.com/files/argentina1.xml" },
  { id: "guide-pe", region: "PE", url: "https://open-epg.com/files/peru1.xml" },
  { id: "guide-ve", region: "VE", url: "https://open-epg.com/files/venezuela1.xml" },
  { id: "guide-hn", region: "HN", url: "https://open-epg.com/files/honduras1.xml" },
  { id: "guide-sv", region: "SV", url: "https://open-epg.com/files/elsalvador1.xml" },
  { id: "guide-gt", region: "GT", url: "https://open-epg.com/files/guatemala1.xml" },
  { id: "guide-ec", region: "EC", url: "https://open-epg.com/files/ecuador1.xml" },
  { id: "guide-uy", region: "UY", url: "https://open-epg.com/files/uruguay1.xml" },
  { id: "guide-py", region: "PY", url: "https://open-epg.com/files/paraguay1.xml" },
  { id: "guide-us", region: "US", url: "https://open-epg.com/files/unitedstates1.xml" }
];

export function defaultGuideSources() {
  return DEFAULT_GUIDE_SOURCES.map((source) => ({ ...source }));
}
