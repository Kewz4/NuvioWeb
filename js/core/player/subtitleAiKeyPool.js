// Built-in Groq API keys for this household build.
//
// Supplied at build time via SUBTITLE_AI_GROQ_KEYS in the gitignored
// local.properties (comma-separated), the same mechanism the TMDB and Trakt
// credentials already use. A user-entered key in Settings always wins over
// these; when neither exists, the AI subtitle actions say so instead of failing
// silently.
//
// Deliberately NOT hardcoded here: this repository has a public remote, and a
// live key pushed to one is revoked by secret scanning within hours — which
// would break subtitle generation for the people using the TV, with nothing on
// screen to explain why.
//
// Note for whoever adds more later: Groq meters tokens-per-day PER
// ORGANISATION, not per key, so extra keys only buy capacity if they come from
// a different org. Two keys in one org share a single 100k/day counter.

function readConfiguredKeys() {
  const raw = globalThis?.__NUVIO_ENV__?.SUBTITLE_AI_GROQ_KEYS;
  return String(raw || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

// Resolved once: the runtime env is written before the bundle loads and never
// changes afterwards, and re-splitting on every request would be wasteful in
// the translation loop.
const BUILT_IN_GROQ_KEYS = readConfiguredKeys();

let rotationIndex = 0;

/** Round-robins the built-in keys so per-minute limits are spread across them. */
export function nextBuiltInGroqKey() {
  if (!BUILT_IN_GROQ_KEYS.length) {
    return "";
  }
  const key = BUILT_IN_GROQ_KEYS[rotationIndex % BUILT_IN_GROQ_KEYS.length];
  rotationIndex += 1;
  return key;
}

/**
 * Moves to the next key, e.g. after the current one reports a rate limit.
 *
 * `nextBuiltInGroqKey` already leaves the index pointing at the following key,
 * so this is simply another draw — incrementing again here would skip one and,
 * with two keys, hand back the very key that just failed.
 */
export function rotateBuiltInGroqKey() {
  return nextBuiltInGroqKey();
}

export function builtInGroqKeyCount() {
  return BUILT_IN_GROQ_KEYS.length;
}

export function hasBuiltInGroqKeys() {
  return BUILT_IN_GROQ_KEYS.length > 0;
}

/** Test seam: lets the suite exercise rotation without shipping fixtures. */
export function __resetGroqKeyRotationForTests() {
  rotationIndex = 0;
}

/** Test seam: replaces the resolved pool, since the real one is build-time. */
export function __setBuiltInGroqKeysForTests(keys = []) {
  BUILT_IN_GROQ_KEYS.length = 0;
  BUILT_IN_GROQ_KEYS.push(...keys.filter(Boolean));
  rotationIndex = 0;
}
