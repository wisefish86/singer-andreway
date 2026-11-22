#!/usr/bin/env python3
"""Refresh self-hosted HLS from the approved Google Sheets media snapshot.

The website publishes the snapshot separately; this job consumes that snapshot,
not a private spreadsheet. New/changed MP4s are processed automatically. Existing
streams remain published on any failure and are never overwritten mid-playback.
"""
import ftplib
import hashlib
import io
import json
import os
import pathlib
import subprocess
import tempfile
import urllib.parse
import urllib.request

SITE = "https://singer.andreway.ru"
ROOT = "/www/singer.andreway.ru"
MAX_VIDEOS = 20
MAX_BYTES = 500_000_000
ENCODE_VERSION = 2  # bump when codec metadata or encoding parameters change


def request_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "singer-hls-sync/1.0", "Cache-Control": "no-cache"}), timeout=40) as res:
        data = res.read(1_000_001)
    if len(data) > 1_000_000:
        raise ValueError("Oversized catalog")
    return json.loads(data)


def safe_filename(name):
    return (isinstance(name, str) and len(name) <= 200 and name.lower().endswith(".mp4")
            and not any(x in name for x in ("/", "\\", "..", "<", ">")))


def download(name, target):
    url = SITE + "/videos/" + urllib.parse.quote(name)
    dig = hashlib.sha256()
    size = 0
    with urllib.request.urlopen(url, timeout=90) as response, open(target, "wb") as out:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError("Video exceeds the 500 MB automation cap")
            out.write(chunk)
            dig.update(chunk)
    if size < 1024:
        raise ValueError("Empty video")
    return dig.hexdigest()


def encode(src, directory):
    for variant, height, bitrate, maxrate, bufsize, audio in (
        ("720p", "1280", "1900k", "2300k", "4600k", "160k"),
        ("480p", "854", "750k", "950k", "1900k", "128k"),
    ):
        output = directory / variant
        output.mkdir(parents=True, exist_ok=True)
        subprocess.run([
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(src), "-map", "0:v:0", "-map", "0:a:0?",
            "-vf", f"scale=-2:{height}:flags=bicubic,fps=30",
            "-c:v", "libx264", "-preset", "veryfast", "-b:v", bitrate,
            "-maxrate", maxrate, "-bufsize", bufsize, "-pix_fmt", "yuv420p",
            "-profile:v", "main", "-level:v", "3.1", "-g", "180", "-keyint_min", "180", "-sc_threshold", "0",
            "-c:a", "aac", "-b:a", audio, "-ac", "2", "-ar", "48000",
            "-f", "hls", "-hls_time", "6", "-hls_list_size", "0",
            "-hls_playlist_type", "vod", "-hls_flags", "independent_segments",
            "-hls_segment_filename", str(output / "segment_%04d.ts"),
            str(output / "index.m3u8")
        ], check=True, timeout=900)
        playlist = (output / "index.m3u8").read_text()
        if "#EXT-X-ENDLIST" not in playlist or "segment_0000.ts" not in playlist:
            raise ValueError("Incomplete " + variant + " playlist")
    (directory / "master.m3u8").write_text(
        '#EXTM3U\n#EXT-X-VERSION:3\n'
        '#EXT-X-STREAM-INF:BANDWIDTH=2450000,RESOLUTION=720x1280,FRAME-RATE=30.000,CODECS="avc1.4d401f,mp4a.40.2"\n'
        '720p/index.m3u8\n'
        '#EXT-X-STREAM-INF:BANDWIDTH=1100000,RESOLUTION=480x854,FRAME-RATE=30.000,CODECS="avc1.4d401f,mp4a.40.2"\n'
        '480p/index.m3u8\n', encoding="utf-8")


def put(ftp, remote, data):
    ftp.storbinary("STOR " + remote, io.BytesIO(data))


def upload_stream(ftp, directory, prefix):
    for folder in ("videos", "videos/hls", "videos/hls/" + prefix):
        try:
            ftp.mkd(ROOT + "/" + folder)
        except ftplib.error_perm as e:
            if not str(e).startswith("550"):
                raise
    for variant in ("720p", "480p"):
        try:
            ftp.mkd(ROOT + "/videos/hls/" + prefix + "/" + variant)
        except ftplib.error_perm as e:
            if not str(e).startswith("550"):
                raise
        for path in sorted((directory / variant).iterdir()):
            with path.open("rb") as source:
                ftp.storbinary("STOR " + ROOT + "/videos/hls/" + prefix + "/" + variant + "/" + path.name, source)
    with (directory / "master.m3u8").open("rb") as source:
        ftp.storbinary("STOR " + ROOT + "/videos/hls/" + prefix + "/master.m3u8", source)


def validate_stream(prefix):
    for path in ("master.m3u8", "720p/index.m3u8", "480p/index.m3u8",
                 "720p/segment_0000.ts", "480p/segment_0000.ts"):
        url = SITE + "/videos/hls/" + prefix + "/" + path
        with urllib.request.urlopen(url, timeout=30) as response:
            head = response.read(1024)
            if not head:
                raise ValueError("Empty remote HLS segment " + path)


def main():
    data = request_json(SITE + "/data/media.json")
    entries = data.get("videos")
    if not isinstance(entries, list) or len(entries) > MAX_VIDEOS:
        raise ValueError("Expected at most 20 published videos")
    names = list(dict.fromkeys(v.get("file") for v in entries if isinstance(v, dict) and safe_filename(v.get("file"))))
    try:
        published = request_json(SITE + "/data/video-hls.json")
    except Exception:
        published = {}
    existing = {v["file"]: v for v in published.get("videos", []) if isinstance(v, dict) and safe_filename(v.get("file")) and isinstance(v.get("sha256"), str)} if isinstance(published.get("videos"), list) else {}
    result = []
    with ftplib.FTP(os.environ["FTP_HOST"], timeout=60) as ftp:
        ftp.login(os.environ["FTP_USER"], os.environ["FTP_PASSWORD"])
        for name in names:
            try:
                with tempfile.TemporaryDirectory() as temp:
                    base = pathlib.Path(temp)
                    source = base / "input.mp4"
                    digest = download(name, source)
                    prev = existing.get(name)
                    if prev and prev.get("sha256") == digest and prev.get("encode_version") == ENCODE_VERSION and str(prev.get("url", "")).startswith("/videos/hls/"):
                        result.append(prev)
                        print("Unchanged:", name)
                        continue
                    # Distinct immutable directory per file and content version; no in-place overwrite.
                    prefix = hashlib.sha256(name.encode()).hexdigest()[:16] + "-" + digest[:12] + "-v" + str(ENCODE_VERSION)
                    output = base / "output"
                    output.mkdir()
                    encode(source, output)
                    upload_stream(ftp, output, prefix)
                    validate_stream(prefix)
                    result.append({"file": name, "sha256": digest, "encode_version": ENCODE_VERSION, "url": "/videos/hls/" + prefix + "/master.m3u8"})
                    print("Prepared:", name, prefix)
            except Exception as exc:
                print("Failed:", repr(name), type(exc).__name__, str(exc)[:150])
                if name in existing:
                    # Preserve a previously published version instead of falling back to MP4.
                    result.append(existing[name])
                else:
                    raise
        if not result and names:
            raise ValueError("No playable video variants")
        payload = json.dumps({"version": 2, "videos": result}, ensure_ascii=False, separators=(",", ":")).encode()
        put(ftp, ROOT + "/data/video-hls.json.tmp", payload)
        ftp.rename(ROOT + "/data/video-hls.json.tmp", ROOT + "/data/video-hls.json")
    print("HLS published:", len(result), "video(s).")


if __name__ == "__main__":
    main()
