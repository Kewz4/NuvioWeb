// Live TV sources shipped with this build.
//
// Chosen by measurement, not reputation. Each candidate list was parsed and a
// spread sample of its 1080p+ channels was fetched to see whether the stream
// actually returns an HLS manifest:
//
//   Español (todos)  1306 FHD+ ch  81% playable
//   Estados Unidos    958 FHD+ ch  88% playable
//   Chile             110 FHD+ ch  81% playable
//   México             90 FHD+ ch  75% playable
//   Colombia           78 FHD+ ch  75% playable
//   Argentina         132 FHD+ ch  56% playable
//   España            262 FHD+ ch  56% playable
//
// The Free-TV/IPTV playlists are deliberately absent: they parse cleanly but
// scored 0/10 playable from here, so shipping them would fill the tab with dead
// channels. Free public IPTV always has some rot, which is why the tab reports
// per-playlist load failures instead of hiding them.

export const DEFAULT_IPTV_PLAYLISTS = [
  {
    id: "default-spa",
    name: "Español (todos)",
    url: "https://iptv-org.github.io/iptv/languages/spa.m3u",
    epgUrl: "",
    enabled: true
  },
  {
    id: "default-mx",
    name: "México",
    url: "https://iptv-org.github.io/iptv/countries/mx.m3u",
    epgUrl: "",
    enabled: true
  },
  {
    id: "default-cl",
    name: "Chile",
    url: "https://iptv-org.github.io/iptv/countries/cl.m3u",
    epgUrl: "",
    enabled: true
  },
  {
    id: "default-co",
    name: "Colombia",
    url: "https://iptv-org.github.io/iptv/countries/co.m3u",
    epgUrl: "",
    enabled: true
  },
  {
    id: "default-ar",
    name: "Argentina",
    url: "https://iptv-org.github.io/iptv/countries/ar.m3u",
    epgUrl: "",
    enabled: true
  },
  {
    id: "default-es",
    name: "España",
    url: "https://iptv-org.github.io/iptv/countries/es.m3u",
    epgUrl: "",
    enabled: true
  },
  {
    id: "default-us",
    name: "Estados Unidos",
    url: "https://iptv-org.github.io/iptv/countries/us.m3u",
    // Off by default: this household watches Spanish. It is one toggle away in
    // Settings for anyone who wants it.
    enabled: false
  }
];

export function defaultIptvPlaylists() {
  return DEFAULT_IPTV_PLAYLISTS.map((playlist) => ({ ...playlist }));
}
