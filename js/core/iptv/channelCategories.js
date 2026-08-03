// Canonical Live TV categories.
//
// Playlists tag channels with a free-form `group-title`, and iptv-org uses a
// *compound* one: "Animation;Kids", "Classic;Comedy;Public;Series". Grouping on
// the raw string produces seventy categories, most of them near-duplicates of
// each other ("Kids" 44, "Animation;Kids" 48, "Kids;Public" 5), which is
// unusable with a remote — and the household this build is for navigates it
// with a remote.
//
// So each raw group is reduced to one canonical category. Compound tags are
// split and resolved by priority, most specific first: "Classic;Comedy;Public;
// Series" is a series channel, not a "Classic" one, so SERIES must outrank the
// generic tags it is bundled with.

export const CATEGORY_NEWS = "news";
export const CATEGORY_SPORTS = "sports";
export const CATEGORY_KIDS = "kids";
export const CATEGORY_MOVIES = "movies";
export const CATEGORY_SERIES = "series";
export const CATEGORY_DOCUMENTARY = "documentary";
export const CATEGORY_MUSIC = "music";
export const CATEGORY_RELIGIOUS = "religious";
export const CATEGORY_CULTURE = "culture";
export const CATEGORY_ENTERTAINMENT = "entertainment";
export const CATEGORY_GENERAL = "general";

/**
 * Display order. Chosen for this household rather than alphabetically: news and
 * sports are what actually gets watched, and the untagged mass sits last.
 */
export const CATEGORY_ORDER = [
  CATEGORY_NEWS,
  CATEGORY_SPORTS,
  CATEGORY_MOVIES,
  CATEGORY_SERIES,
  CATEGORY_ENTERTAINMENT,
  CATEGORY_KIDS,
  CATEGORY_MUSIC,
  CATEGORY_DOCUMENTARY,
  CATEGORY_CULTURE,
  CATEGORY_RELIGIOUS,
  CATEGORY_GENERAL
];

// Raw tag -> canonical category. Tags absent here fall through to "general".
//
// "Public" is deliberately general, not culture: it marks a public broadcaster
// (TVE, Canal 22), which is a funding model, not a genre — a public news channel
// belongs under news, and "General;Public" belongs with the other general ones.
const TAG_TO_CATEGORY = {
  news: CATEGORY_NEWS,
  weather: CATEGORY_NEWS,
  sports: CATEGORY_SPORTS,
  kids: CATEGORY_KIDS,
  animation: CATEGORY_KIDS,
  movies: CATEGORY_MOVIES,
  classic: CATEGORY_MOVIES,
  series: CATEGORY_SERIES,
  documentary: CATEGORY_DOCUMENTARY,
  science: CATEGORY_DOCUMENTARY,
  nature: CATEGORY_DOCUMENTARY,
  travel: CATEGORY_DOCUMENTARY,
  outdoor: CATEGORY_DOCUMENTARY,
  music: CATEGORY_MUSIC,
  religious: CATEGORY_RELIGIOUS,
  culture: CATEGORY_CULTURE,
  education: CATEGORY_CULTURE,
  legislative: CATEGORY_CULTURE,
  entertainment: CATEGORY_ENTERTAINMENT,
  comedy: CATEGORY_ENTERTAINMENT,
  lifestyle: CATEGORY_ENTERTAINMENT,
  cooking: CATEGORY_ENTERTAINMENT,
  family: CATEGORY_ENTERTAINMENT,
  relax: CATEGORY_ENTERTAINMENT,
  shop: CATEGORY_ENTERTAINMENT,
  auto: CATEGORY_ENTERTAINMENT,
  business: CATEGORY_ENTERTAINMENT,
  general: CATEGORY_GENERAL,
  public: CATEGORY_GENERAL,
  undefined: CATEGORY_GENERAL
};

/**
 * Which tag wins in a compound group, most specific first.
 *
 * A channel tagged "Movies;News" is a news channel that also runs films; a
 * viewer looking for the news must find it under news. The generic tags sit at
 * the bottom so they only ever win when nothing else is present.
 */
const CATEGORY_PRIORITY = [
  CATEGORY_KIDS,
  CATEGORY_SPORTS,
  CATEGORY_NEWS,
  CATEGORY_SERIES,
  CATEGORY_MOVIES,
  CATEGORY_DOCUMENTARY,
  CATEGORY_MUSIC,
  CATEGORY_RELIGIOUS,
  CATEGORY_CULTURE,
  CATEGORY_ENTERTAINMENT,
  CATEGORY_GENERAL
];

/** The canonical category for a raw `group-title`. Never returns "". */
export function canonicalCategoryKey(rawGroup = "") {
  const tags = String(rawGroup || "")
    // Providers use ";", "|" and "/" interchangeably as tag separators.
    .split(/[;|/]/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

  const matched = new Set();
  tags.forEach((tag) => {
    const category = TAG_TO_CATEGORY[tag];
    if (category) {
      matched.add(category);
    }
  });
  if (!matched.size) {
    return CATEGORY_GENERAL;
  }
  return CATEGORY_PRIORITY.find((category) => matched.has(category)) || CATEGORY_GENERAL;
}

/** i18n key for a canonical category's label. */
export function categoryLabelKey(category = CATEGORY_GENERAL) {
  return `iptv_category_${category}`;
}
