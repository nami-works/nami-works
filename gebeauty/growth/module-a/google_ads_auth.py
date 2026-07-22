"""
Google Ads API - one-time refresh-token minter (Module A).

Run this ONCE, locally, signed in as a Google user who has access to GE Beauty's Google
Ads account. It opens a browser consent screen, captures the code on a localhost loopback,
exchanges it for a refresh token, and prints the .env lines to paste. Read-only scope.

Usage:
  python google_ads_auth.py

Prereq: the Desktop OAuth client at gebeauty/scripts/google_oauth_credentials.json
(project ge-beauty-copilot) with the Google Ads API enabled on that project.
Stdlib only.
"""
import json
import sys
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]  # c:/claude
CLIENT_FILE = REPO / "gebeauty" / "scripts" / "google_oauth_credentials.json"
SCOPE = "https://www.googleapis.com/auth/adwords"  # Google Ads API scope
AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
PORT = 8765  # loopback port; any free port works for a Desktop client

_code = {}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(q)
        _code["code"] = params.get("code", [None])[0]
        _code["error"] = params.get("error", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        msg = "Google Ads authorization received. You can close this tab and return to the terminal."
        self.wfile.write(f"<html><body style='font-family:sans-serif'>{msg}</body></html>".encode())

    def log_message(self, *a):
        pass


def main():
    c = json.loads(CLIENT_FILE.read_text())["installed"]
    client_id, client_secret = c["client_id"], c["client_secret"]
    redirect_uri = f"http://localhost:{PORT}"

    auth_url = AUTH_URI + "?" + urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",   # required to get a refresh token
        "prompt": "consent",        # force a refresh token even on re-auth
    })

    print("Opening the Google consent screen in your browser...")
    print("If it does not open, paste this URL:\n\n" + auth_url + "\n")
    webbrowser.open(auth_url)

    srv = HTTPServer(("localhost", PORT), Handler)
    srv.handle_request()  # serve exactly one request (the redirect)
    srv.server_close()

    if _code.get("error"):
        print("Authorization failed:", _code["error"]); sys.exit(1)
    if not _code.get("code"):
        print("No authorization code captured."); sys.exit(1)

    data = urllib.parse.urlencode({
        "code": _code["code"],
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }).encode()
    req = urllib.request.Request(TOKEN_URI, data=data,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        tok = json.loads(resp.read().decode())

    refresh = tok.get("refresh_token")
    if not refresh:
        print("No refresh_token returned. Re-run (the consent must be granted fresh).")
        print("Response keys:", list(tok.keys())); sys.exit(1)

    print("\n" + "=" * 64)
    print("SUCCESS. Add these to gebeauty/.env (fill the token + IDs you have):")
    print("=" * 64)
    print(f"GOOGLE_ADS_CLIENT_ID={client_id}")
    print(f"GOOGLE_ADS_CLIENT_SECRET={client_secret}")
    print(f"GOOGLE_ADS_REFRESH_TOKEN={refresh}")
    print("GOOGLE_ADS_DEVELOPER_TOKEN=   # 22-char token from the Ads API Center")
    print("GOOGLE_ADS_CUSTOMER_ID=       # GE's 10-digit customer id, digits only")
    print("GOOGLE_ADS_LOGIN_CUSTOMER_ID= # the MCC id (digits only) if access is via a manager account, else leave blank")
    print("=" * 64)


if __name__ == "__main__":
    main()
