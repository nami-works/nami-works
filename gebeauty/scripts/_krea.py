#!/usr/bin/env python
"""Minimal Krea public-API client (direct HTTP; bypasses the MCP client).

Auth + endpoint come from gebeauty/.env (KREA_API_TOKEN), resolved
relative to THIS file so it works from any cwd. The MCP JSON-RPC endpoint is
https://api.krea.ai/mcp; large asset uploads use REST POST https://api.krea.ai/assets.

CLI:
  python _krea.py upload <path>                 -> prints asset image_url
  python _krea.py models [video|image]          -> list models
  python _krea.py schema <model_id>             -> model input schema
  python _krea.py genvideo <input.json>         -> submit, prints job id
  python _krea.py job <job_id>                  -> poll once
  python _krea.py wait <job_id>                 -> poll until terminal, print result url(s)
"""
import json, sys, os, time, uuid, mimetypes, urllib.request, urllib.error
from pathlib import Path

ENV = {}
for line in (Path(__file__).resolve().parent.parent / ".env").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1); ENV[k.strip()] = v.strip().strip('"').strip("'")
TOKEN = ENV["KREA_API_TOKEN"]
MCP = "https://api.krea.ai/mcp"
ASSETS = "https://api.krea.ai/assets"

def _mcp(method, params):
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    req = urllib.request.Request(MCP, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json",
                 "Accept": "application/json, text/event-stream",
                 "Authorization": f"Bearer {TOKEN}"})
    try:
        raw = urllib.request.urlopen(req, timeout=120).read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
    if raw.startswith("data:") or "\ndata:" in raw:
        for ln in raw.splitlines():
            if ln.startswith("data:"): raw = ln[5:].strip(); break
    return json.loads(raw)

def tool(name, args):
    """Call an MCP tool, return its parsed JSON text content (or the raw envelope)."""
    j = _mcp("tools/call", {"name": name, "arguments": args})
    if "error" in j: return j
    content = (j.get("result") or {}).get("content")
    if content:
        txt = "\n".join(x.get("text", "") for x in content if x.get("type") == "text")
        try: return json.loads(txt)
        except Exception: return {"_text": txt}
    return j.get("result", j)

def upload(path):
    """REST multipart upload (handles up to 75MB). Returns the asset dict (has image_url/url)."""
    p = Path(path); fn = p.name
    mime = mimetypes.guess_type(fn)[0] or "application/octet-stream"
    b = "----krea" + uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{fn}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n").encode() + p.read_bytes() + f"\r\n--{b}--\r\n".encode()
    req = urllib.request.Request(ASSETS, data=body, method="POST",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": f"multipart/form-data; boundary={b}"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=300).read().decode())
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "_body": e.read().decode(errors="replace")[:500]}

def genvideo(model, inp, sync=False):
    return tool("generate_video", {"model": model, "input": inp, "sync": sync})

def get_job(job_id):
    return tool("get_job", {"jobId": job_id})

def _job_id(resp):
    for k in ("jobId", "job_id", "id"):
        if isinstance(resp, dict) and resp.get(k): return resp[k]
    j = resp.get("job") if isinstance(resp, dict) else None
    if isinstance(j, dict):
        for k in ("id", "jobId", "job_id"):
            if j.get(k): return j[k]
    return None

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "upload":
        print(json.dumps(upload(sys.argv[2]), indent=2))
    elif cmd == "models":
        ms = tool("list_models", {}).get("models", [])
        cat = sys.argv[2] if len(sys.argv) > 2 else None
        for m in ms:
            if not cat or m.get("category") == cat: print(m["id"], "|", m.get("name"))
    elif cmd == "schema":
        print(json.dumps(tool("get_model_schema", {"model": sys.argv[2]}), indent=2)[:4000])
    elif cmd == "genvideo":
        inp = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        r = genvideo(inp.pop("model"), inp)
        print(json.dumps(r, indent=2)); print("JOB_ID:", _job_id(r))
    elif cmd == "job":
        print(json.dumps(get_job(sys.argv[2]), indent=2))
    elif cmd == "wait":
        jid = sys.argv[2]
        for _ in range(120):
            r = get_job(jid); st = (r.get("status") or r.get("state") or "").lower()
            print("status:", st or r)
            if st in ("completed", "succeeded", "success", "failed", "error", "cancelled"):
                print(json.dumps(r, indent=2)); break
            time.sleep(10)
    else:
        print(__doc__)
