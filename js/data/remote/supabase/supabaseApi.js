import { httpRequest } from "../../../core/network/httpClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../../config.js";

function buildHeaders(extra = {}, useSession = true) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    ...extra
  };
  if (!useSession && headers.Authorization == null) {
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  return headers;
}

// Reads that several callers ask for at once during startup. Three separate
// parts of the app pull the profile settings blob and the home catalog settings
// on every launch, each paying a full round trip for the same answer — about
// 400 ms apiece on a TV. Coalescing means the second and third callers wait on
// the first request instead of opening their own.
//
// Deliberately only reads. A repeated write may well be intended, and folding
// two pushes into one would lose the second.
const COALESCABLE_RPC = /^(sync_pull_|get_)/;
const inFlightReads = new Map();

export const SupabaseApi = {
  rpc(functionName, body = {}, useSession = true) {
    const request = () =>
      httpRequest(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }, useSession),
        includeSessionAuth: useSession,
        body: JSON.stringify(body)
      });

    if (!COALESCABLE_RPC.test(String(functionName || ""))) {
      return request();
    }

    // The body is part of the key: pulling two different profiles' settings is
    // two different questions.
    const key = `${functionName}|${useSession}|${JSON.stringify(body || {})}`;
    const existing = inFlightReads.get(key);
    if (existing) {
      return existing;
    }
    // Cleared the moment it settles, so this shares a request in flight and
    // never caches a stale answer for the next caller.
    const pending = request().finally(() => {
      inFlightReads.delete(key);
    });
    inFlightReads.set(key, pending);
    return pending;
  },

  select(table, query = "", useSession = true) {
    const suffix = query ? `?${query}` : "";
    return httpRequest(`${SUPABASE_URL}/rest/v1/${table}${suffix}`, {
      method: "GET",
      headers: buildHeaders({}, useSession),
      includeSessionAuth: useSession
    });
  },

  upsert(table, rows, onConflict = null, useSession = true) {
    const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
    return httpRequest(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
      method: "POST",
      headers: buildHeaders(
        {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        useSession
      ),
      includeSessionAuth: useSession,
      body: JSON.stringify(rows)
    });
  },

  delete(table, query, useSession = true) {
    return httpRequest(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: "DELETE",
      headers: buildHeaders({ Prefer: "return=representation" }, useSession),
      includeSessionAuth: useSession
    });
  }
};
