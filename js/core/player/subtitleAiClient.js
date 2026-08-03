// Thin client for the LLM providers backing subtitle auto-sync and translation.
//
// Deliberately uses bare `fetch` rather than core/network/httpClient.js: that
// helper attaches the user's Nuvio session token by default, which must never
// be sent to a third-party API.

export const SUBTITLE_AI_PROVIDERS = ["gemini", "groq"];
export const DEFAULT_SUBTITLE_AI_PROVIDER = "gemini";

// Ordered candidates. If a model has been retired server-side we transparently
// fall back rather than dead-ending a feature the user is waiting on.
// Verified against the live API: gemini-2.5-flash-lite returns 404 ("no longer
// available to new users"), so it is deliberately absent. 2.0-flash is the
// fallback because it has no thinking mode at all.
const MODEL_CANDIDATES = {
  gemini: ["gemini-2.5-flash", "gemini-2.0-flash"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
};

const PROVIDER_LABELS = { gemini: "Gemini", groq: "Groq" };

const DEFAULT_TIMEOUT_MS = 45000;

// Token budgets on free tiers refill per minute, so a handful of patient
// retries carries a long translation through instead of failing it.
const MAX_RATE_LIMIT_RETRIES = 5;
const DEFAULT_RATE_LIMIT_WAIT_MS = 20000;
const MAX_RATE_LIMIT_WAIT_MS = 65000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parses the duration format Groq uses in its rate-limit reset headers
 * ("190ms", "7.66s", "1m26.4s") into milliseconds.
 */
export function parseRateLimitDuration(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }
  const match = text.match(
    /^(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/
  );
  if (!match || (!match[1] && !match[2] && !match[3])) {
    const bare = Number(text);
    return Number.isFinite(bare) ? Math.round(bare * 1000) : 0;
  }
  const minutes = Number(match[1] || 0);
  const seconds = Number(match[2] || 0);
  const millis = Number(match[3] || 0);
  return Math.round(minutes * 60000 + seconds * 1000 + millis);
}

function readRateLimit(headers) {
  const get = (name) => headers?.get?.(name) ?? null;
  const remainingTokens = Number(get("x-ratelimit-remaining-tokens"));
  const limitTokens = Number(get("x-ratelimit-limit-tokens"));
  return {
    remainingTokens: Number.isFinite(remainingTokens) ? remainingTokens : null,
    limitTokens: Number.isFinite(limitTokens) ? limitTokens : null,
    resetTokensMs: parseRateLimitDuration(get("x-ratelimit-reset-tokens"))
  };
}

/** Honours a Retry-After header when present, clamped to something sane. */
export function rateLimitWaitMs(retryAfter) {
  const seconds = Number(String(retryAfter ?? "").trim());
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(Math.ceil(seconds * 1000), MAX_RATE_LIMIT_WAIT_MS);
  }
  return DEFAULT_RATE_LIMIT_WAIT_MS;
}

export function normalizeSubtitleAiProvider(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return SUBTITLE_AI_PROVIDERS.includes(normalized) ? normalized : DEFAULT_SUBTITLE_AI_PROVIDER;
}

export function subtitleAiProviderLabel(provider) {
  return PROVIDER_LABELS[normalizeSubtitleAiProvider(provider)];
}

export function subtitleAiModelCandidates(provider, preferredModel = "") {
  const normalized = normalizeSubtitleAiProvider(provider);
  const defaults = MODEL_CANDIDATES[normalized];
  const preferred = String(preferredModel || "").trim();
  if (!preferred) {
    return [...defaults];
  }
  return [preferred, ...defaults.filter((model) => model !== preferred)];
}

/**
 * Best-effort JSON object extraction from a model response that may be wrapped
 * in prose or markdown fences.
 */
export function extractJsonObject(rawText = "") {
  const text = String(rawText || "").trim();
  if (!text) {
    return null;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1]?.trim(), text].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (_) {
      // Fall through to brace scanning.
    }

    // Scan for the first balanced {...} run, ignoring braces inside strings.
    const start = candidate.indexOf("{");
    if (start < 0) {
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index += 1) {
      const char = candidate[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(candidate.slice(start, index + 1));
            if (parsed && typeof parsed === "object") {
              return parsed;
            }
          } catch (_) {
            // Keep scanning for a later well-formed object.
          }
          break;
        }
      }
    }
  }
  return null;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch (_) {
          // Ignore abort failures on legacy engines.
        }
      }, timeoutMs)
    : null;
  try {
    return await fetch(url, controller ? { ...init, signal: controller.signal } : init);
  } finally {
    if (timer != null) {
      clearTimeout(timer);
    }
  }
}

/**
 * Distinguishes a per-DAY quota hit from a per-minute one.
 *
 * Per-minute budgets refill in seconds, so waiting works. A daily budget does
 * not, and the quota is metered per model, so the only useful response is to
 * move to the next model rather than stall the viewer for twenty minutes.
 */
export function isDailyQuotaResponse(bodyText) {
  const text = String(bodyText || "");
  return /tokens per day|TPD|requests per day|RPD|PerDay/i.test(text);
}

function isMissingModelResponse(status, bodyText) {
  if (status !== 404 && status !== 400) {
    return false;
  }
  return (
    /model/i.test(String(bodyText || "")) &&
    /(not found|not exist|decommission|unsupported|deprecat)/i.test(String(bodyText || ""))
  );
}

async function requestGroq({ model, apiKey, prompt, timeoutMs }) {
  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }]
      })
    },
    timeoutMs
  );
  const bodyText = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      bodyText,
      retryAfter: response.headers?.get?.("retry-after") || null
    };
  }
  let payload = null;
  try {
    payload = JSON.parse(bodyText);
  } catch (_) {
    return {
      ok: false,
      status: response.status,
      bodyText,
      retryAfter: response.headers?.get?.("retry-after") || null
    };
  }
  return {
    ok: true,
    rawText: String(payload?.choices?.[0]?.message?.content || ""),
    rateLimit: readRateLimit(response.headers)
  };
}

async function requestGemini({ model, apiKey, prompt, timeoutMs }) {
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Header auth keeps the key out of the URL (and out of any proxy logs).
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          // Gemini 2.5 models think by default, and thinking tokens are billed
          // as output tokens. Both of our tasks are mechanical (index matching,
          // line-for-line translation) with zero benefit from reasoning, and
          // leaving it on burned ~3.5x more output than input tokens, which is
          // what exhausted the free-tier quota.
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    },
    timeoutMs
  );
  const bodyText = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      bodyText,
      retryAfter: response.headers?.get?.("retry-after") || null
    };
  }
  let payload = null;
  try {
    payload = JSON.parse(bodyText);
  } catch (_) {
    return {
      ok: false,
      status: response.status,
      bodyText,
      retryAfter: response.headers?.get?.("retry-after") || null
    };
  }
  const parts = payload?.candidates?.[0]?.content?.parts;
  const rawText = Array.isArray(parts) ? parts.map((part) => part?.text || "").join("") : "";
  return { ok: true, rawText: String(rawText), rateLimit: readRateLimit(response.headers) };
}

/**
 * Sends `prompt` to the configured provider and returns the parsed JSON object.
 *
 * @throws {Error} with a user-presentable message when the key is missing, the
 *   provider rejects the request, or no JSON could be recovered.
 */
export async function requestSubtitleAiJson({
  provider,
  apiKey,
  prompt,
  model = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRateLimitRetries = MAX_RATE_LIMIT_RETRIES,
  onRateLimit = () => {}
} = {}) {
  const normalizedProvider = normalizeSubtitleAiProvider(provider);
  const label = subtitleAiProviderLabel(normalizedProvider);
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error(`${label} API key is missing. Set it in Settings > Playback > Subtitles.`);
  }

  const candidates = subtitleAiModelCandidates(normalizedProvider, model);
  const send = normalizedProvider === "groq" ? requestGroq : requestGemini;

  let lastFailure = "";
  let retriesLeft = Math.max(0, Number(maxRateLimitRetries) || 0);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    let result;
    try {
      result = await send({ model: candidate, apiKey: key, prompt, timeoutMs });
    } catch (error) {
      // Network/abort failures are not model-specific, so stop here.
      const reason = error?.name === "AbortError" ? "request timed out" : error?.message || error;
      throw new Error(`${label} request failed: ${reason}`);
    }

    if (!result.ok) {
      lastFailure = `HTTP ${result.status}`;
      if (isMissingModelResponse(result.status, result.bodyText)) {
        continue;
      }
      if (result.status === 401 || result.status === 403) {
        throw new Error(
          `${label} rejected the API key. Check it in Settings > Playback > Subtitles.`
        );
      }
      if (result.status === 429) {
        // A daily budget will not refill today, but each model has its own, so
        // move on instead of waiting. Only the last model has nowhere to go.
        if (isDailyQuotaResponse(result.bodyText)) {
          if (index < candidates.length - 1) {
            onRateLimit({ waitMs: 0, provider: normalizedProvider, switchedModel: true });
            continue;
          }
          throw new Error(
            `${label} has used its daily free-tier quota for every available model. It resets in a few hours.`
          );
        }
        // Per-minute budgets refill on a timer, so wait it out rather than
        // abandoning a half-finished translation.
        if (retriesLeft > 0) {
          const waitMs = rateLimitWaitMs(result.retryAfter);
          onRateLimit({ waitMs, provider: normalizedProvider, retriesLeft });
          await delay(waitMs);
          retriesLeft -= 1;
          index -= 1; // Retry the same model rather than falling to the next.
          continue;
        }
        throw new Error(`${label} rate limit reached. Try again in a moment.`);
      }
      throw new Error(`${label} request failed (${lastFailure}).`);
    }

    const json = extractJsonObject(result.rawText);
    if (!json) {
      throw new Error(`${label} returned a response that was not valid JSON.`);
    }
    return {
      json,
      rawText: result.rawText,
      model: candidate,
      provider: normalizedProvider,
      rateLimit: result.rateLimit || null
    };
  }

  throw new Error(`${label} has no usable model available (${lastFailure || "unknown error"}).`);
}
