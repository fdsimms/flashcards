"""The MCP over HTTP as Claude connects to it: discovery, registration, the password page, tokens."""

from __future__ import annotations

import base64
import hashlib
import secrets
import socket
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import httpx2
import pytest
import uvicorn
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from franki_mcp import auth
from franki_mcp.__main__ import PROXY_NETWORKS, build_app
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.auth import OAuthClientInformationFull

pytestmark = pytest.mark.anyio

PASSWORD = "correct horse battery"
CALLBACK = "https://claude.ai/api/mcp/auth_callback"


@contextmanager
def serving(sync_server: str, data: Path):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    public = f"http://127.0.0.1:{port}"
    app, cm = build_app({
        "MCP_PUBLIC_URL": public, "MCP_PASSWORD": PASSWORD, "MCP_DATA": str(data),
        "ANKI_SYNC_ENDPOINT": sync_server, "ANKI_USER": "user", "ANKI_PASSWORD": "pass",
    })
    # Proxies trusted as main() trusts them, so a test's X-Forwarded-For stands for the address Caddy passes on.
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", forwarded_allow_ips=PROXY_NETWORKS))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.05)
    try:
        yield public
    finally:
        server.should_exit = True
        thread.join(5)
        cm.close()


@pytest.fixture
def served(desktop, sync_server, tmp_path):
    with serving(sync_server, tmp_path / "data") as public:
        yield public


def pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def client_auth(client: dict, secret: str | None = None) -> dict:
    """What a token request adds to prove it's this client, by the method it registered with."""
    secret = client.get("client_secret") if secret is None else secret
    method = client["token_endpoint_auth_method"]
    if method == "client_secret_basic":
        return {"data": {"client_id": client["client_id"]},
                "headers": {"Authorization": "Basic " + base64.b64encode(f"{client['client_id']}:{secret}".encode()).decode()}}
    if method == "client_secret_post":
        return {"data": {"client_id": client["client_id"], "client_secret": secret}, "headers": {}}
    return {"data": {"client_id": client["client_id"]}, "headers": {}}


def token(http: httpx.Client, client: dict, form: dict, secret: str | None = None) -> httpx.Response:
    proof = client_auth(client, secret)
    return http.post("/token", data={**form, **proof["data"]}, headers=proof["headers"])


def sign_in(http: httpx.Client, public: str, redirect: str = CALLBACK, password: str = PASSWORD, used: str | None = None,
            method: str = "none", client: dict | None = None, exchange: bool = True) -> dict:
    """Claude's side of connecting: register (unless given a client), open the approval page, submit the password, swap the code."""
    if client is None:
        client = http.post("/register", json={"client_name": "Claude", "redirect_uris": [redirect],
                                              "token_endpoint_auth_method": method, "grant_types": ["authorization_code", "refresh_token"]}).json()
    redirect = used or redirect  # Claude Code registers one loopback port and comes back on another
    verifier, challenge = pkce()
    r = http.get("/authorize", params={"response_type": "code", "client_id": client["client_id"], "redirect_uri": redirect,
                                       "code_challenge": challenge, "code_challenge_method": "S256", "state": "xyz",
                                       "resource": f"{public}/mcp"})
    assert r.status_code == 302
    page = urlparse(r.headers["location"])
    assert page.path == "/approve"
    request_id = parse_qs(page.query)["request"][0]
    assert "Connect Claude to Franki?" in http.get(f"/approve?request={request_id}").text
    r = http.post("/approve", data={"request": request_id, "password": password})
    if r.status_code != 302:
        return {"page": r.text}
    back = urlparse(r.headers["location"])
    q = parse_qs(back.query)
    assert q["state"] == ["xyz"]
    done = {"client_id": client["client_id"], "client": client, "code": q["code"][0], "redirect": redirect, "verifier": verifier}
    if not exchange:
        return done
    tokens = token(http, client, {"grant_type": "authorization_code", "code": q["code"][0], "redirect_uri": redirect,
                                  "code_verifier": verifier}).json()
    return {**tokens, **done}


def stored(data: Path) -> dict[str, list[tuple[str, str]]]:
    """The sign-in database's rows, table by table, as a copy of the file would show them."""
    db = sqlite3.connect(data / "signins.sqlite")
    try:
        return {t: db.execute(f"select id, data from {t}").fetchall() for t in ("clients", "codes", "access", "refresh")}
    finally:
        db.close()


def test_tells_claude_where_to_sign_in(served):
    with httpx.Client(base_url=served) as http:
        r = http.post("/mcp", json={})
        assert r.status_code == 401
        assert "resource_metadata=" in r.headers["www-authenticate"]
        prm = http.get("/.well-known/oauth-protected-resource/mcp").json()
        assert prm["resource"] == f"{served}/mcp"
        meta = http.get("/.well-known/oauth-authorization-server").json()
        assert meta["registration_endpoint"] == f"{served}/register" and "S256" in meta["code_challenge_methods_supported"]


def test_refuses_a_wrong_password_and_other_redirects(served):
    with httpx.Client(base_url=served) as http:
        assert "That password isn&#x27;t right." in sign_in(http, served, password="wrong")["page"]
        r = http.post("/register", json={"client_name": "x", "redirect_uris": ["https://evil.example/cb"], "token_endpoint_auth_method": "none"})
        assert r.status_code == 400 and "only signs in Claude" in r.text


def test_clients_that_never_signed_in_are_kept_only_up_to_a_limit(served, monkeypatch):
    monkeypatch.setattr(auth, "MAX_UNUSED_CLIENTS", 3)
    with httpx.Client(base_url=served) as http:
        signed_in = sign_in(http, served)
        body = {"client_name": "x", "redirect_uris": [CALLBACK], "token_endpoint_auth_method": "none"}
        unused = [http.post("/register", json=body).json()["client_id"] for _ in range(5)]

        def known(client_id: str) -> bool:
            r = http.get("/authorize", params={"response_type": "code", "client_id": client_id, "redirect_uri": CALLBACK,
                                               "code_challenge": pkce()[1], "code_challenge_method": "S256"})
            return r.status_code == 302

        assert [known(c) for c in unused] == [False, False, True, True, True]
        # The one that signed in is older than all of them and stays: its refresh token still works.
        assert known(signed_in["client_id"])
        r = http.post("/token", data={"grant_type": "refresh_token", "refresh_token": signed_in["refresh_token"], "client_id": signed_in["client_id"]})
        assert r.status_code == 200


def test_codes_work_once_and_refresh_tokens_rotate(served):
    with httpx.Client(base_url=served) as http:
        t = sign_in(http, served)
        assert t["access_token"] and t["refresh_token"]
        again = http.post("/token", data={"grant_type": "authorization_code", "code": t["code"], "redirect_uri": t["redirect"],
                                          "client_id": t["client_id"], "code_verifier": t["verifier"]})
        assert again.status_code == 400 and again.json()["error"] == "invalid_grant"
        refreshed = http.post("/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": t["client_id"]}).json()
        assert refreshed["refresh_token"] != t["refresh_token"]
        old = http.post("/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": t["client_id"]})
        assert old.json()["error"] == "invalid_grant"
        # The access token from before the refresh went with it.
        assert http.post("/mcp", json={}, headers={"Authorization": f"Bearer {t['access_token']}"}).status_code == 401


async def test_claude_code_on_any_loopback_port_then_uses_the_tools(served):
    with httpx.Client(base_url=served) as http:
        t = sign_in(http, served, redirect="http://127.0.0.1:33418/callback", used="http://127.0.0.1:51234/callback")
        assert t["access_token"]
    headers = {"Authorization": f"Bearer {t['access_token']}"}
    async with httpx2.AsyncClient(headers=headers, timeout=30) as h:
        async with Client(streamable_http_client(f"{served}/mcp", http_client=h)) as client:
            decks = (await client.call_tool("list_decks", {})).structured_content["decks"]
    assert any(d["deck"] == "🧠 Trivia" for d in decks)


def from_address(public: str, address: str) -> httpx.Client:
    """A browser at this address, as Caddy passes its requests on."""
    return httpx.Client(base_url=public, headers={"X-Forwarded-For": address})


def test_wrong_passwords_lock_out_their_own_address_only(served, monkeypatch):
    monkeypatch.setattr(auth, "WRONG_PASSWORD_DELAY", 0)
    with from_address(served, "203.0.113.7") as stranger:
        for _ in range(auth.MAX_FAILURES):
            assert "That password isn&#x27;t right." in sign_in(stranger, served, password="wrong")["page"]
        # Locked out: even the right password isn't checked from there.
        assert "Too many wrong passwords from your network. Try again in 15 minutes." in sign_in(stranger, served)["page"]
    with from_address(served, "198.51.100.4") as owner:
        assert sign_in(owner, served)["access_token"]


def test_brute_force_across_new_clients_and_ipv6_addresses_stays_limited(served, monkeypatch):
    monkeypatch.setattr(auth, "WRONG_PASSWORD_DELAY", 0)
    # A newly registered client for every guess (sign_in registers one each time), each from a new address in one IPv6 /64.
    for n in range(auth.MAX_FAILURES):
        with from_address(served, f"2001:db8:1:2::{n + 1:x}") as http:
            assert "That password isn&#x27;t right." in sign_in(http, served, password="wrong")["page"]
    with from_address(served, "2001:db8:1:2:ffff::1") as http:
        assert "Too many wrong passwords from your network" in sign_in(http, served)["page"]
    with from_address(served, "2001:db8:1:3::1") as http:
        assert sign_in(http, served)["access_token"]


def test_guesses_from_many_addresses_pause_the_page_for_minutes(served, monkeypatch):
    monkeypatch.setattr(auth, "WRONG_PASSWORD_DELAY", 0)
    for a in range(auth.MAX_FAILURES_ALL // auth.MAX_FAILURES):
        with from_address(served, f"192.0.2.{a + 1}") as http:
            for _ in range(auth.MAX_FAILURES):
                assert "That password isn&#x27;t right." in sign_in(http, served, password="wrong")["page"]
    with from_address(served, "198.51.100.4") as owner:
        page = sign_in(owner, served)["page"]
    assert "Too many wrong passwords have been tried in the last few minutes. Try again in 5 minutes." in page


@pytest.mark.parametrize("peer, forwarded, seen", [
    ("172.18.0.5", "198.51.100.4", "198.51.100.4"),  # Caddy, on the compose network, passing a request on
    ("172.18.0.5", "6.6.6.6, 198.51.100.4", "198.51.100.4"),  # an address the client wrote in front is skipped
    ("203.0.113.9", "198.51.100.4", "203.0.113.9"),  # anyone else can't name an address
])
async def test_only_the_proxy_says_where_a_request_came_from(peer, forwarded, seen):
    got = {}

    async def app(scope, receive, send):
        got["client"] = scope["client"][0]

    scope = {"type": "http", "client": (peer, 1234), "headers": [(b"x-forwarded-for", forwarded.encode())]}
    await ProxyHeadersMiddleware(app, PROXY_NETWORKS)(scope, None, None)
    assert got["client"] == seen


def test_codes_are_stored_only_as_hashes(served, tmp_path):
    with httpx.Client(base_url=served) as http:
        t = sign_in(http, served, exchange=False)
        [(key, data)] = stored(tmp_path / "data")["codes"]
        assert key == hashlib.sha256(t["code"].encode()).hexdigest() and t["code"] not in data
        # Looked up by the hash of the code Claude sends, it still swaps once for tokens.
        r = token(http, t["client"], {"grant_type": "authorization_code", "code": t["code"], "redirect_uri": t["redirect"],
                                      "code_verifier": t["verifier"]})
        assert r.status_code == 200 and r.json()["access_token"]
        # The stored hash itself is no code.
        t = sign_in(http, served, exchange=False)
        [(key, _)] = stored(tmp_path / "data")["codes"]
        r = token(http, t["client"], {"grant_type": "authorization_code", "code": key, "redirect_uri": t["redirect"],
                                      "code_verifier": t["verifier"]})
        assert r.status_code == 400 and r.json()["error"] == "invalid_grant"


@pytest.mark.parametrize("method", ["client_secret_post", "client_secret_basic"])
def test_clients_with_a_secret_sign_in_and_only_its_hash_is_stored(served, tmp_path, method):
    with httpx.Client(base_url=served) as http:
        t = sign_in(http, served, method=method)
        secret = t["client"]["client_secret"]
        assert len(secret) == 64 and t["access_token"] and t["refresh_token"]
        rows = stored(tmp_path / "data")
        [(_, data)] = [row for row in rows["clients"] if row[0] == t["client_id"]]
        assert secret not in data and hashlib.sha256(secret.encode()).hexdigest() in data
        assert not any(secret in d or t["access_token"] in d or t["refresh_token"] in d for table in rows.values() for _, d in table)

        refresh = {"grant_type": "refresh_token", "refresh_token": t["refresh_token"]}
        for wrong in ("not the secret", hashlib.sha256(secret.encode()).hexdigest()):  # a copy of the database doesn't sign in
            r = token(http, t["client"], refresh, secret=wrong)
            assert r.status_code == 401 and r.json()["error"] == "invalid_client"
        r = token(http, t["client"], refresh)
        assert r.status_code == 200 and r.json()["refresh_token"] != t["refresh_token"]


def test_a_client_registered_before_secrets_were_hashed_still_signs_in(desktop, sync_server, tmp_path):
    # The database as the MCP left it before: the secret stored as issued, and a code under itself.
    data = tmp_path / "data"
    data.mkdir()
    secret = secrets.token_hex(32)
    old = OAuthClientInformationFull(client_id="old-client", client_secret=secret, client_id_issued_at=int(time.time()),
                                     redirect_uris=[CALLBACK], token_endpoint_auth_method="client_secret_post",
                                     grant_types=["authorization_code", "refresh_token"], client_name="Claude")
    db = sqlite3.connect(data / "signins.sqlite")
    for table in ("clients", "codes"):
        db.execute(f"create table {table} (id text primary key, data text not null, expires real)")
    db.execute("insert into clients values (?, ?, null)", (old.client_id, old.model_dump_json()))
    db.execute("insert into codes values ('old-code', ?, ?)", ('{"code": "old-code"}', time.time() + 300))
    db.commit()
    db.close()
    with serving(sync_server, data) as public, httpx.Client(base_url=public) as http:
        rows = stored(data)
        assert secret not in rows["clients"][0][1] and rows["codes"] == []
        t = sign_in(http, public, client=old.model_dump(mode="json"))
        assert t["access_token"]
        r = token(http, t["client"], {"grant_type": "refresh_token", "refresh_token": t["refresh_token"]}, secret="wrong")
        assert r.status_code == 401
