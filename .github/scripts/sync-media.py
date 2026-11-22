#!/usr/bin/env python3
"""Publish approved Google Sheets photo/video rows to one atomic static snapshot.

No visitor ever calls Google Apps Script. A failed sync leaves the prior snapshot live.
"""
import ftplib
import json
import os
import tempfile
import urllib.request

SOURCE = os.environ["MEDIA_API_URL"]
HOST = os.environ["FTP_HOST"]
USER = os.environ["FTP_USER"]
PASSWORD = os.environ["FTP_PASSWORD"]

req = urllib.request.Request(SOURCE, headers={"User-Agent": "singer-media-sync/1.0"})
with urllib.request.urlopen(req, timeout=60) as response:
    raw = response.read(1_000_001)
if len(raw) > 1_000_000:
    raise ValueError("Media API response exceeds 1MB")
payload = json.loads(raw)
if not isinstance(payload, dict):
    raise ValueError("Media API must return an object")
result = {}
for key, valid_suffixes in {
    "videos": (".mp4", ".webm"),
    "photos": (".jpg", ".jpeg", ".png", ".webp", ".avif"),
}.items():
    data = payload.get(key)
    if not isinstance(data, list) or len(data) > 500:
        raise ValueError("Invalid public " + key)
    output = []
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("Invalid media entry")
        clean = {name: item.get(name, "") for name in ("title", "file", "description", "cover")}
        if any(not isinstance(value, str) for value in clean.values()):
            raise ValueError("Invalid media field")
        if any(len(value) > 500 for value in clean.values()):
            raise ValueError("Oversized media field")
        filename = clean["file"]
        if not filename.lower().endswith(valid_suffixes) or any(x in filename for x in ("/", "\\", "..", "<", ">")):
            raise ValueError("Unsafe media filename")
        cover = clean["cover"]
        if cover and (not cover.lower().endswith((".webp", ".jpg", ".jpeg", ".png", ".avif")) or any(x in cover for x in ("/", "\\", "..", "<", ">"))):
            raise ValueError("Unsafe cover filename")
        output.append(clean)
    result[key] = output

snapshot = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
with tempfile.TemporaryFile() as stream:
    stream.write(snapshot)
    stream.seek(0)
    with ftplib.FTP(HOST, timeout=35) as ftp:
        ftp.login(USER, PASSWORD)
        ftp.cwd("/www/singer.andreway.ru/data")
        ftp.storbinary("STOR media.json.tmp", stream)
        ftp.rename("media.json.tmp", "media.json")
print("Published media snapshot:", len(result["videos"]), "videos,", len(result["photos"]), "photos")
