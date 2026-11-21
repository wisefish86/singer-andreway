#!/usr/bin/env python3
"""Make small cached WebP previews. Never modify the originals on FTP."""
import concurrent.futures
import io
import json
import pathlib
import urllib.parse
import urllib.request
from PIL import Image, ImageOps

ROOT = pathlib.Path("public")
catalog = json.loads((ROOT / "media-catalog.json").read_text(encoding="utf8"))
base = "https://singer.andreway.ru/"
tasks = []
for item in catalog.get("photos", []):
    name = item["file"]
    tasks.append(("photos", name, [name]))
for item in catalog.get("videos", []):
    name = item["file"]
    stem = name.rsplit(".", 1)[0]
    endings = ["webp", "jpg", "jpeg", "png", "avif"]
    preferred = item.get("cover", "").rsplit(".", 1)[-1].lower()
    if preferred in endings:
        endings.remove(preferred)
        endings.insert(0, preferred)
    tasks.append(("videos", name, [stem + "." + ext for ext in endings]))

def make_thumb(item):
    folder, filename, candidates = item
    dest = ROOT / "thumbs" / folder / (filename.rsplit(".", 1)[0] + ".webp")
    dest.parent.mkdir(parents=True, exist_ok=True)
    img = None
    for name in candidates:
        url = base + folder + "/" + urllib.parse.quote(name, safe="")
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "ANDREY-SPOET-preview-cache/1.0"})
            with urllib.request.urlopen(request, timeout=24) as response:
                raw = response.read(24 * 1024 * 1024 + 1)
                if len(raw) > 24 * 1024 * 1024:
                    raise ValueError("Image too large")
            with Image.open(io.BytesIO(raw)) as original:
                img = ImageOps.exif_transpose(original)
                img.load()
            break
        except Exception:
            continue
    if img is None:
        # Preserve prior thumbnail if source temporarily unavailable.
        print(f"Not available yet: {folder}/{filename}")
        return
    img.thumbnail((760, 760), Image.Resampling.LANCZOS)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    output = io.BytesIO()
    img.save(output, format="WEBP", quality=79, method=5)
    new_bytes = output.getvalue()
    if not dest.exists() or dest.read_bytes() != new_bytes:
        dest.write_bytes(new_bytes)
        print(f"Thumbnail updated: {dest}, {len(new_bytes)} bytes")

with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    list(pool.map(make_thumb, tasks))
