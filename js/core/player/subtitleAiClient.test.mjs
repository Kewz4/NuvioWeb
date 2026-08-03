import assert from "node:assert/strict";
import test from "node:test";

import {
  extractJsonObject,
  normalizeSubtitleAiProvider,
  requestSubtitleAiJson,
  subtitleAiModelCandidates
} from "./subtitleAiClient.js";

test("normalizes provider names and falls back to the default", () => {
  assert.equal(normalizeSubtitleAiProvider("GROQ"), "groq");
  assert.equal(normalizeSubtitleAiProvider(" gemini "), "gemini");
  assert.equal(normalizeSubtitleAiProvider("nonsense"), "gemini");
  assert.equal(normalizeSubtitleAiProvider(null), "gemini");
});

test("puts a preferred model first without duplicating it", () => {
  const candidates = subtitleAiModelCandidates("groq", "llama-3.1-8b-instant");
  assert.equal(candidates[0], "llama-3.1-8b-instant");
  assert.equal(new Set(candidates).size, candidates.length);
});

test("extracts JSON from fenced, prose-wrapped and bare responses", () => {
  assert.deepEqual(extractJsonObject('```json\n{"pairs":[]}\n```'), { pairs: [] });
  assert.deepEqual(extractJsonObject('Sure! {"pairs":[{"source_index":1}]} hope that helps'), {
    pairs: [{ source_index: 1 }]
  });
  assert.deepEqual(extractJsonObject('{"pairs":[]}'), { pairs: [] });
  assert.equal(extractJsonObject("no json here"), null);
  assert.equal(extractJsonObject(""), null);
});

test("ignores braces inside string values when scanning", () => {
  assert.deepEqual(extractJsonObject('prefix {"text":"a } brace","ok":true} suffix'), {
    text: "a } brace",
    ok: true
  });
});

test("rejects a missing API key before making any request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("fetch should not be called");
  };
  try {
    await assert.rejects(
      () => requestSubtitleAiJson({ provider: "groq", apiKey: "  ", prompt: "hi" }),
      /Groq API key is missing/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("surfaces an invalid key as a clear message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => '{"error":"invalid api key"}'
  });
  try {
    await assert.rejects(
      () => requestSubtitleAiJson({ provider: "gemini", apiKey: "bad", prompt: "hi" }),
      /Gemini rejected the API key/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to the next model when one is decommissioned", async () => {
  const originalFetch = globalThis.fetch;
  const attempted = [];
  globalThis.fetch = async (url, init) => {
    const model = JSON.parse(init.body).model;
    attempted.push(model);
    if (attempted.length === 1) {
      return {
        ok: false,
        status: 400,
        text: async () => '{"error":{"message":"The model `x` has been decommissioned"}}'
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: '{"pairs":[{"source_index":0}]}' } }] })
    };
  };
  try {
    const result = await requestSubtitleAiJson({ provider: "groq", apiKey: "k", prompt: "hi" });
    assert.deepEqual(result.json, { pairs: [{ source_index: 0 }] });
    assert.equal(attempted.length, 2);
    assert.equal(result.model, attempted[1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sends the Gemini key as a header rather than a query parameter", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenHeaders = null;
  globalThis.fetch = async (url, init) => {
    seenUrl = String(url);
    seenHeaders = init.headers;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] })
    };
  };
  try {
    await requestSubtitleAiJson({ provider: "gemini", apiKey: "secret-key", prompt: "hi" });
    assert.ok(!seenUrl.includes("secret-key"), "API key must not appear in the URL");
    assert.equal(seenHeaders["x-goog-api-key"], "secret-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("computes rate-limit waits from Retry-After, clamped", async () => {
  const { rateLimitWaitMs } = await import("./subtitleAiClient.js");
  assert.equal(rateLimitWaitMs("30"), 30000);
  assert.equal(rateLimitWaitMs("2.5"), 2500);
  // A provider asking for an absurd wait is clamped so playback is not stalled.
  assert.equal(rateLimitWaitMs("9999"), 65000);
  // Missing or junk headers fall back to a fixed wait.
  assert.equal(rateLimitWaitMs(null), 20000);
  assert.equal(rateLimitWaitMs("soon"), 20000);
});

test("waits out a rate limit and retries the same model", async () => {
  const originalFetch = globalThis.fetch;
  const models = [];
  let calls = 0;
  const waits = [];
  globalThis.fetch = async (url, init) => {
    calls += 1;
    models.push(JSON.parse(init.body).model);
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: (h) => (h === "retry-after" ? "1" : null) },
        text: async () => '{"error":"rate limit"}'
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })
    };
  };
  try {
    const result = await requestSubtitleAiJson({
      provider: "groq",
      apiKey: "k",
      prompt: "hi",
      onRateLimit: ({ waitMs }) => waits.push(waitMs)
    });
    assert.deepEqual(result.json, { ok: true });
    assert.equal(calls, 2);
    // Same model retried, not silently downgraded to the fallback.
    assert.equal(models[0], models[1]);
    assert.deepEqual(waits, [1000]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gives up with a clear message once retries are exhausted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: () => "1" },
    text: async () => '{"error":"rate limit"}'
  });
  try {
    await assert.rejects(
      () =>
        requestSubtitleAiJson({
          provider: "groq",
          apiKey: "k",
          prompt: "hi",
          maxRateLimitRetries: 1
        }),
      /rate limit reached/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
