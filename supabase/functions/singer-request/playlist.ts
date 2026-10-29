/** Build a UTF-8 MusicBee playlist without ever accessing the owner's PC.
 * The public song list has one entry per song_id and a path for every local
 * technical version. Only relative paths are published; the Windows library
 * root is supplied server-side.
 */
type RecordValue = Record<string, unknown>;

function object(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeLabel(value: unknown): string {
  return String(value ?? "").replace(/[\r\n\u0000]/g, " ").trim();
}

export function makeM3U8(ids: string[], catalog: unknown, libraryRoot: string): string {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !/^[a-f0-9]{16}$/.test(id))) {
    throw new Error("Invalid song IDs");
  }
  if (!object(catalog) || Number(catalog.schema_version) < 6 || !Array.isArray(catalog.songs)) {
    throw new Error("Public catalogue with playlist_variants (v6+) required");
  }
  const root = libraryRoot.replace(/[\\/]+$/, "");
  if (!/^[a-zA-Z]:[\\/]/.test(root)) throw new Error("Windows MP3 root is not configured");
  const songs = [...catalog.songs, ...(Array.isArray(catalog.learning_songs) ? catalog.learning_songs : [])];
  const byId = new Map<string, RecordValue>();
  for (const song of songs) {
    if (object(song) && typeof song.id === "string") byId.set(song.id, song);
  }

  const lines = ["#EXTM3U"];
  const seen = new Set<string>();
  for (const id of new Set(ids)) {
    const song = byId.get(id);
    if (!song || !Array.isArray(song.playlist_variants) || !song.playlist_variants.length) {
      throw new Error("Playlist version missing for song " + id);
    }
    for (const entry of song.playlist_variants) {
      if (!object(entry) || typeof entry.relative_path !== "string") {
        throw new Error("Invalid playlist variant for song " + id);
      }
      const rel = entry.relative_path.replace(/\\/g, "/");
      const pieces = rel.split("/");
      if (pieces.some(part => !part || part === "." || part === "..") ||
          rel.startsWith("/") || /^[a-zA-Z]:/.test(rel) ||
          /[\r\n\u0000]/.test(rel)) {
        throw new Error("Unsafe playlist path for song " + id);
      }
      const full = root + "\\" + pieces.join("\\");
      if (seen.has(full.toLowerCase())) continue;
      seen.add(full.toLowerCase());
      const seconds = typeof entry.duration_seconds === "number" &&
        Number.isFinite(entry.duration_seconds) && entry.duration_seconds >= 0
          ? Math.round(entry.duration_seconds) : -1;
      const display = safeLabel(song.artist) + " - " +
        safeLabel(entry.title || song.name);
      lines.push("#EXTINF:" + seconds + "," + display, full);
    }
  }
  if (lines.length === 1) throw new Error("No MP3 versions found");
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
