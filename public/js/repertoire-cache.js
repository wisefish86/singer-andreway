/* Fast first paint from a local copy of the PUBLIC song catalogue.
 * Never cache customer selections, request tokens, or API responses.
 */
(() => {
  'use strict';
  const KEY = 'singer-repertoire:catalogue:v1';
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function valid(value) {
    return !!value && Array.isArray(value.songs) && value.songs.length > 0 &&
      value.facets && typeof value.facets === 'object';
  }
  function read() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!stored || !Number.isFinite(stored.savedAt) ||
          Date.now() - stored.savedAt > MAX_AGE_MS || !valid(stored.catalogue)) return null;
      return stored.catalogue;
    } catch { return null; }
  }
  function write(catalogue) {
    if (!valid(catalogue)) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), catalogue }));
      return true;
    } catch { return false; }
  }
  function updated(before, after) {
    return !before || before.generated_at !== after.generated_at ||
      before.schema_version !== after.schema_version ||
      before.song_count !== after.song_count;
  }
  window.SingerRepertoireCache = Object.freeze({ read, write, valid, updated });
})();
