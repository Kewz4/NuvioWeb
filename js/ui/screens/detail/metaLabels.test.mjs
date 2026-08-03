import assert from "node:assert/strict";
import test from "node:test";

import { localizeCountryList, localizeLanguage, localizeMetaStatus } from "./metaLabels.js";

const es = (key) =>
  ({
    series_status_returning: "En emisión",
    series_status_ended: "Finalizada",
    movie_status_released: "Estrenada"
  })[key] || "";
const translate = (key, _params, options) => es(key) || options?.fallback || "";

test("TMDB and Cinemeta spellings collapse onto one key", () => {
  assert.equal(localizeMetaStatus("Returning Series", "series", translate), "En emisión");
  assert.equal(localizeMetaStatus("returning", "series", translate), "En emisión");
  assert.equal(localizeMetaStatus("Ended", "series", translate), "Finalizada");
  assert.equal(localizeMetaStatus("Released", "movie", translate), "Estrenada");
});

test("movies and series use their own key sets", () => {
  // Only movie_status_released is defined above, so asking for the series key
  // must not silently borrow it.
  assert.equal(localizeMetaStatus("Released", "series", translate), "Released");
});

test("an unrecognised status is shown as-is rather than blanked", () => {
  assert.equal(localizeMetaStatus("Some New State", "series", translate), "Some New State");
  assert.equal(localizeMetaStatus("", "series", translate), "");
  // With no translator available the raw value is still the best answer.
  assert.equal(localizeMetaStatus("Ended", "series", null), "Ended");
});

test("country codes become names in the active locale", () => {
  assert.equal(localizeCountryList("US", "es-419"), "Estados Unidos");
  assert.equal(localizeCountryList("US, MX", "es-419"), "Estados Unidos, México");
  assert.equal(localizeCountryList("US", "en"), "United States");
});

test("a country that is already a name passes through untouched", () => {
  assert.equal(localizeCountryList("United Kingdom", "es-419"), "United Kingdom");
  assert.equal(localizeCountryList("", "es-419"), "");
});

test("language codes become names, and plain text is left alone", () => {
  assert.equal(localizeLanguage("en", "es-419"), "inglés");
  assert.equal(localizeLanguage("es", "es-419"), "español");
  assert.equal(localizeLanguage("Klingon", "es-419"), "Klingon");
  assert.equal(localizeLanguage("", "es-419"), "");
});
