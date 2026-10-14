#!/usr/bin/env python3
"""Import original Anytype Block V2 ZIPs from FTP into Notion. Fail closed."""
import io
import json
import os
import time
import urllib.request
import urllib.error
import zipfile
from ftplib import FTP

HOST = "andreway.ru"
BASE = "/www/andreway.ru/notion-import"
SOURCE = "01_Inbox"
DEST = "02_Done"
DATA_SOURCE = "3e056f1afcfe80e1b558000bd0464a2b"
NOTION = "https://api.notion.com/v1"
TYPES = {"paragraph", "heading_1", "heading_2", "heading_3", "toggle_heading_3",
         "bulleted_list_item", "numbered_list_item", "quote", "divider"}
TOKEN = os.environ["NOTION_API_TOKEN"]
HEADERS = {
    "Authorization": "Bearer " + TOKEN,
    "Notion-Version": "2025-09-03",
    "Content-Type": "application/json",
}

def api(method, path, data=None):
    payload = None if data is None else json.dumps(data, ensure_ascii=False).encode("utf-8")
    for attempt in range(6):
        req = urllib.request.Request(NOTION + path, data=payload, headers=HEADERS, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                response = json.load(r)
            time.sleep(0.37)
            return response
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(max(float(e.headers.get("Retry-After", "1")), 2 ** attempt))
                continue
            reason = e.read().decode("utf-8")[:350]
            raise RuntimeError("Notion API HTTP " + str(e.code) + ": " + reason) from None
    raise RuntimeError("API retry exhausted")

def rich(text):
    text = str(text)
    return [{"type": "text", "text": {"content": text[i:i+1800]}}
            for i in range(0, len(text), 1800)] if text else []

def build_tree(raw_blocks):
    roots = []
    stack = []
    prev_depth = 0
    for i, b in enumerate(raw_blocks):
        kind = b.get("type")
        if kind not in TYPES:
            raise ValueError("Unsupported block type at index " + str(i) + ": " + str(kind))
        if set(b) - {"id", "type", "text", "indent"}:
            raise ValueError("Unexpected block fields at index " + str(i))
        depth = b.get("indent", 0)
        if not isinstance(depth, int) or depth < 0 or depth > prev_depth + 1:
            raise ValueError("Unexpected nesting at index " + str(i))
        if i == 0 and depth != 0:
            raise ValueError("First block is nested")
        if depth > 0 and not stack:
            raise ValueError("Missing nested parent")
        node = {"type": kind, "text": b.get("text", ""), "children": []}
        stack = stack[:depth]
        if depth:
            parent = stack[-1]
            if parent["type"] == "divider":
                raise ValueError("Divider cannot have nested blocks")
            parent["children"].append(node)
        else:
            roots.append(node)
        stack.append(node)
        prev_depth = depth
    return roots

def notation(node):
    kind = node["type"].removeprefix("toggle_")
    if kind == "divider":
        return {"object": "block", "type": "divider", "divider": {}}
    value = {"rich_text": rich(node["text"])}
    if kind.startswith("heading_") and (node["children"] or node["type"].startswith("toggle_")):
        value["is_toggleable"] = True
    return {"object": "block", "type": kind, kind: value}

def block_to_tuple(b, depth):
    kind = b["type"]
    if kind.startswith("heading_") and b.get(kind, {}).get("is_toggleable"):
        kind = "toggle_" + kind if b.get("_was_toggle") else kind
    data = b.get(b["type"], {})
    text = "".join(x.get("plain_text", x.get("text", {}).get("content", ""))
                   for x in data.get("rich_text", []))
    return (depth, b["type"], text)

def expected_flat(nodes, depth=0):
    result = []
    for n in nodes:
        result.append((depth, n["type"].removeprefix("toggle_"), str(n["text"])))
        result.extend(expected_flat(n["children"], depth + 1))
    return result

def remote_flat(parent, depth=0):
    out = []
    cursor = None
    while True:
        path = "/blocks/" + parent + "/children?page_size=100"
        if cursor: path += "&start_cursor=" + urllib.parse.quote(cursor)
        result = api("GET", path)
        for b in result.get("results", []):
            out.append(block_to_tuple(b, depth))
            if b.get("has_children"):
                out.extend(remote_flat(b["id"], depth + 1))
        if not result.get("has_more"): break
        cursor = result.get("next_cursor")
    return out

def find_existing(title):
    filter_spec = {"filter": {"property": "Name", "title": {"equals": title}}, "page_size": 100}
    response = api("POST", "/data_sources/" + DATA_SOURCE + "/query", filter_spec)
    if response.get("has_more") or len(response["results"]) > 1:
        raise ValueError("Ambiguous existing pages for same title")
    return response["results"][0] if response["results"] else None

def create_page(title, category, emoji):
    props = {"Name": {"title": [{"text": {"content": title[:2000]}}]},
             "Тип": {"select": {"name": "📄 Заметка"}}}
    if category:
        props["Область"] = {"multi_select": [{"name": category}]}
    req = {"parent": {"type": "data_source_id", "data_source_id": DATA_SOURCE},
           "properties": props}
    if emoji:
        req["icon"] = {"type": "emoji", "emoji": emoji}
    return api("POST", "/pages", req)

def append_nodes(parent, nodes):
    # The Notion block API accepts up to 100 sibling blocks per request.
    for pos in range(0, len(nodes), 80):
        group = nodes[pos:pos + 80]
        response = api("PATCH", "/blocks/" + parent + "/children",
                       {"children": [notation(n) for n in group]})
        added = response.get("results", [])
        if len(added) != len(group):
            raise RuntimeError("Incomplete Notion append response")
        for original, created in zip(group, added):
            if original["children"]:
                append_nodes(created["id"], original["children"])

def get_main_document(contents):
    with zipfile.ZipFile(io.BytesIO(contents)) as z:
        infos = z.infolist()
        if len(infos) > 3000 or sum(i.file_size for i in infos) > 500_000_000:
            raise ValueError("Oversized export")
        items = []
        for item in infos:
            if item.filename.lower().endswith(".anyblock.json"):
                obj = json.loads(z.read(item))
                if obj.get("kind") is None and obj.get("formatVersion") == "2.0" and obj.get("blocks"):
                    items.append(obj)
        if len(items) != 1:
            raise ValueError("Expected one main note in each ZIP; found " + str(len(items)))
        return items[0]

def main():
    ftp = FTP(HOST, timeout=60)
    ftp.login("andreway", os.environ["FTP_PASSWORD"])
    ftp.cwd(BASE + "/" + SOURCE)
    names = sorted(p.split("/")[-1] for p in ftp.nlst() if p.lower().endswith(".zip"))
    print("ZIP archives found:", len(names))
    counts = {"verified": 0, "failed": 0}
    for name in names:
        try:
            if "/" in name or "\\\\" in name: raise ValueError("Invalid archive path")
            raw = io.BytesIO()
            ftp.retrbinary("RETR " + BASE + "/" + SOURCE + "/" + name, raw.write)
            doc = get_main_document(raw.getvalue())
            title = doc.get("properties", {}).get("Name")
            if not isinstance(title, str) or not title.strip():
                raise ValueError("Document title missing")
            nodes = build_tree(doc["blocks"])
            if len(nodes) > 1000: raise ValueError("Too many root blocks")
            category = "🎤 Музыка и пение" if "пени" in title.lower() or "твэнг" in title.lower() else None
            icon = doc.get("icon") or {}
            emoji = icon.get("emoji") if icon.get("format") == "emoji" else None
            existing = find_existing(title)
            if existing:
                actual = remote_flat(existing["id"])
                if actual != expected_flat(nodes):
                    raise ValueError("Existing page with same title differs; refusing overwrite")
                page = existing
            else:
                page = create_page(title, category, emoji)
                append_nodes(page["id"], nodes)
            verified = remote_flat(page["id"])
            expected = expected_flat(nodes)
            if verified != expected:
                raise ValueError("Verification mismatch: received " + str(len(verified)) + " of " + str(len(expected)) + " blocks")
            ftp.cwd(BASE + "/" + DEST)
            dest_names = [p.split("/")[-1] for p in ftp.nlst()]
            if name in dest_names:
                raise ValueError("Destination archive already exists")
            ftp.rename(BASE + "/" + SOURCE + "/" + name, BASE + "/" + DEST + "/" + name)
            counts["verified"] += 1
            print("VERIFIED and archived:", name, "blocks:", len(expected), "Notion page:", page["id"])
        except Exception as e:
            counts["failed"] += 1
            print("FAILED, ZIP retained:", name, type(e).__name__, str(e)[:350])
    ftp.quit()
    print("RESULT", counts)
    if counts["failed"]:
        raise SystemExit("Some archives not imported; ZIPs kept in 01_Inbox")

if __name__ == "__main__":
    import urllib.parse
    main()
