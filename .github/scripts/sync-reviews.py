#!/usr/bin/env python3
"""Refresh the public reviews snapshot without making visitors contact Google."""
import ftplib
import json
import os
import tempfile
import urllib.request

SOURCE = os.environ["REVIEWS_API_URL"]
HOST = os.environ["FTP_HOST"]
USER = os.environ["FTP_USER"]
PASSWORD = os.environ["FTP_PASSWORD"]
DESTINATION = "/www/singer.andreway.ru/data"
PUBLIC_FIELDS = ("author", "event", "dateLabel", "city", "text", "avatar", "avatarType")

req = urllib.request.Request(SOURCE, headers={"User-Agent": "singer-reviews-cache/1.0"})
with urllib.request.urlopen(req, timeout=45) as response:
    raw = response.read(1_000_001)
if len(raw) > 1_000_000:
    raise ValueError("Reviews response exceeds 1 MB")
payload = json.loads(raw)
if not isinstance(payload, dict) or not isinstance(payload.get("reviews"), list):
    raise ValueError("Reviews response must contain a reviews array")
if len(payload["reviews"]) > 100:
    raise ValueError("Too many reviews")
reviews = []
for item in payload["reviews"]:
    if not isinstance(item, dict):
        raise ValueError("Invalid review record")
    record = {key: item.get(key, "") for key in PUBLIC_FIELDS}
    if not isinstance(record["author"], str) or not isinstance(record["text"], str):
        raise ValueError("Invalid review content")
    if not record["author"].strip() or not record["text"].strip():
        continue
    if any(not isinstance(value, str) for value in record.values()):
        raise ValueError("Invalid review field")
    reviews.append(record)
snapshot = json.dumps({"updatedAt": payload.get("updatedAt"), "reviews": reviews}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
with tempfile.TemporaryFile() as stream:
    stream.write(snapshot)
    stream.seek(0)
    with ftplib.FTP(HOST, timeout=35) as ftp:
        ftp.login(USER, PASSWORD)
        ftp.cwd(DESTINATION)
        ftp.storbinary("STOR reviews.json.tmp", stream)
        ftp.rename("reviews.json.tmp", "reviews.json")
print("Public reviews snapshot uploaded:", len(reviews), "reviews,", len(snapshot), "bytes")
