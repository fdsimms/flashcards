"""
Sign-in for the MCP: OAuth as Claude's connectors expect it, for one person.

Claude (on the web, the phone and desktop apps, and Claude Code) registers itself (dynamic client
registration), then sends the user here to approve it. The approval page asks for MCP_PASSWORD;
there are no accounts. After that, Claude holds an access token (an hour) and a refresh token
(90 days, replaced at every use), so the password is asked for once per Claude app.

Only Claude's own callback addresses (and a loopback address on any port, which Claude Code
uses) can register, so a code can't be sent anywhere else even if someone else starts the flow.
Tokens, codes and client secrets are kept only as hashes, in a small SQLite file next to the collection,
so a copy of it signs nobody in.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import ipaddress
import json
import math
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

import anyio
from mcp.server.auth import routes as sdk_routes
from mcp.server.auth.middleware.client_auth import ClientAuthenticator
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl, PrivateAttr
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

ACCESS_SECONDS = 3600
REFRESH_SECONDS = 90 * 86400
CODE_SECONDS = 300
PENDING_SECONDS = 600
CLAUDE_CALLBACKS = ("https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback")
LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "[::1]", "::1")
# Wrong passwords on the approval page. Each source (_source) gets 10 per 15 minutes, then the page
# stops checking its passwords until the oldest drops out, however many clients it registers. All
# sources together get 100 per 5 minutes, which bounds guessing from many addresses at once without
# letting a stranger lock the owner out from one: tripping it takes 10 addresses, and it clears 5
# minutes after they stop. (One global count of 10 per 15 minutes let anyone lock the page.)
MAX_FAILURES = 10
FAILURE_WINDOW = 900
MAX_FAILURES_ALL = 100
FAILURE_WINDOW_ALL = 300
WRONG_PASSWORD_DELAY = 1
# Registering needs no password, so clients that never signed in are kept only up to this many, the
# newest: otherwise anyone could fill the disk with them. One that holds a refresh token always stays.
MAX_UNUSED_CLIENTS = 20


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _is_loopback(uri: str) -> bool:
    u = urlparse(uri)
    return u.scheme == "http" and u.hostname in LOOPBACK_HOSTS


def _same_but_port(a: str, b: str) -> bool:
    """RFC 8252 7.3: a loopback redirect matches whatever port the client opened."""
    ua, ub = urlparse(a), urlparse(b)
    return _is_loopback(a) and _is_loopback(b) and ua.hostname == ub.hostname and ua.path == ub.path and ua.query == ub.query


def _source(request: Request) -> str:
    """Where a password came from, as the wrong-password limit counts it: the client address uvicorn
    gives the request (Caddy's X-Forwarded-For, believed only from the proxy's network, see
    PROXY_NETWORKS in __main__), an IPv6 one by its /64, since a connection is usually given a whole /64."""
    host = request.client.host if request.client else ""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return host
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped:
            return str(ip.ipv4_mapped)
        return str(ipaddress.ip_network(f"{ip}/64", strict=False))
    return str(ip)


def _minutes(seconds: float) -> str:
    n = max(1, math.ceil(seconds / 60))
    return "1 minute" if n == 1 else f"{n} minutes"


class Client(OAuthClientInformationFull):
    """A registered client, matching loopback redirects on any port. Its client_secret is None as
    get_client returns it: only the secret's hash is stored, and HashedSecretAuthenticator checks it."""

    _secret_hash: str | None = PrivateAttr(default=None)

    def validate_redirect_uri(self, redirect_uri: AnyUrl | None) -> AnyUrl:
        if redirect_uri is not None and self.redirect_uris:
            if any(_same_but_port(str(redirect_uri), str(r)) for r in self.redirect_uris):
                return redirect_uri
        return super().validate_redirect_uri(redirect_uri)


async def _presented_secret(request: Request, method: str | None) -> str | None:
    """The client secret a /token or /revoke request carries, read where the SDK's ClientAuthenticator
    reads it for the client's method. A malformed header gives None; the SDK then refuses it itself."""
    if method == "client_secret_basic":
        header = request.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return None
        try:
            decoded = base64.b64decode(header[6:]).decode()
        except (ValueError, UnicodeDecodeError):
            return None
        return unquote(decoded.split(":", 1)[1]) if ":" in decoded else None
    if method == "client_secret_post":
        secret = (await request.form()).get("client_secret")
        return secret if isinstance(secret, str) else None
    return None


class _CheckedClients:
    """The provider as one request's ClientAuthenticator sees it: a client comes back holding the
    secret the request presented when its hash matches the stored one, and an unguessable secret when
    it doesn't, so the SDK's own comparison passes only for the right secret (never for the hash)."""

    def __init__(self, provider, request: Request):
        self.provider, self.request = provider, request

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        client = await self.provider.get_client(client_id)
        if not isinstance(client, Client) or client._secret_hash is None:
            return client
        presented = await _presented_secret(self.request, client.token_endpoint_auth_method)
        matched = presented is not None and hmac.compare_digest(_hash(presented).encode(), client._secret_hash.encode())
        return client.model_copy(update={"client_secret": presented if matched else secrets.token_hex(32)})


class HashedSecretAuthenticator(ClientAuthenticator):
    """The SDK's client check at /token and /revoke, against a stored hash. The SDK compares the secret
    a request sends with get_client's client_secret, which can't work when only a hash is kept, so the
    hash is checked first (_CheckedClients) and everything else (the method, Basic auth's client id,
    expiry) is still the SDK's own check."""

    async def authenticate_request(self, request: Request) -> OAuthClientInformationFull:
        return await ClientAuthenticator(_CheckedClients(self.provider, request)).authenticate_request(request)


# create_auth_routes builds the authenticator for /token and /revoke by this module-level name and has
# no parameter for another, so it's replaced here. If an SDK upgrade stops reading it, a client with a
# secret is refused (get_client gives it none), never let in, and test_http's secret sign-ins fail.
sdk_routes.ClientAuthenticator = HashedSecretAuthenticator


class SingleUserAuth:
    """The OAuth provider (OAuthAuthorizationServerProvider), plus the approval page's handlers."""

    def __init__(self, db_path: Path, public_url: str, password: str, extra_redirects: tuple[str, ...] = ()):
        if len(password) < 12:
            raise ValueError("MCP_PASSWORD must be at least 12 characters.")
        self.public_url = public_url.rstrip("/")
        self.password = password
        self.allowed_redirects = (*CLAUDE_CALLBACKS, *extra_redirects)
        self._db = sqlite3.connect(db_path, check_same_thread=False, isolation_level=None)
        self._db.execute("pragma journal_mode = wal")
        for table in ("clients", "pending", "codes", "access", "refresh"):
            self._db.execute(f"create table if not exists {table} (id text primary key, data text not null, expires real)")
        # Before secrets were hashed, a client's was stored as it was issued: hash those, so a client
        # registered then still signs in. Codes were stored under themselves; they last 5 minutes, so
        # they're dropped, and a sign-in caught by a restart starts again from Claude.
        for key, raw in self._db.execute("select id, data from clients where json_extract(data, '$.client_secret') is not null").fetchall():
            data = json.loads(raw)
            data["client_secret_hash"], data["client_secret"] = _hash(data["client_secret"]), None
            self._db.execute("update clients set data = ? where id = ?", (json.dumps(data), key))
        self._db.execute("delete from codes where json_extract(data, '$.code') is not null")
        self._lock = threading.Lock()
        self._failures: dict[str, list[float]] = {}
        self._all_failures: list[float] = []

    # ---- storage ----

    def _put(self, table: str, key: str, data: dict, expires: float | None) -> None:
        with self._lock:
            self._db.execute(f"insert or replace into {table} values (?, ?, ?)", (key, json.dumps(data), expires))
            self._db.execute(f"delete from {table} where expires is not null and expires < ?", (time.time(),))

    def _get(self, table: str, key: str) -> dict | None:
        with self._lock:
            row = self._db.execute(f"select data, expires from {table} where id = ?", (key,)).fetchone()
        if not row or (row[1] is not None and row[1] < time.time()):
            return None
        return json.loads(row[0])

    def _take(self, table: str, key: str) -> dict | None:
        """Gets a row and deletes it: a code or a pending approval is good once."""
        data = self._get(table, key)
        with self._lock:
            self._db.execute(f"delete from {table} where id = ?", (key,))
        return data

    # ---- clients ----

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        data = self._get("clients", client_id)
        if not data:
            return None
        secret_hash = data.pop("client_secret_hash", None)
        client = Client.model_validate(data)
        client._secret_hash = secret_hash
        return client

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        for uri in client_info.redirect_uris or []:
            if not (str(uri) in self.allowed_redirects or _is_loopback(str(uri))):
                raise RegistrationError(
                    error="invalid_redirect_uri",
                    error_description=f"{uri} can't be used here: this server only signs in Claude's apps and local clients.",
                )
        # Only the secret's hash is kept; the client is sent the secret itself (client_info is unchanged).
        data = client_info.model_dump(mode="json")
        if data.get("client_secret"):
            data["client_secret_hash"], data["client_secret"] = _hash(data["client_secret"]), None
        self._put("clients", client_info.client_id, data, None)
        with self._lock:
            self._db.execute(
                """delete from clients where id in (
                    select id from clients
                    where id not in (select json_extract(data, '$.client_id') from refresh where expires > ?)
                    order by json_extract(data, '$.client_id_issued_at') desc, rowid desc limit -1 offset ?)""",
                (time.time(), MAX_UNUSED_CLIENTS),
            )

    # ---- approval ----

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        request_id = secrets.token_urlsafe(24)
        self._put("pending", request_id, {"client_id": client.client_id, "params": params.model_dump(mode="json")}, time.time() + PENDING_SECONDS)
        return f"{self.public_url}/approve?request={request_id}"

    def _page(self, request_id: str, client_name: str, redirect: str, error: str = "") -> HTMLResponse:
        e = html.escape
        body = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect to Franki</title>
<style>
body{{font:17px -apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#f5f2ea;color:#1f1d1a}}
main{{max-width:420px;margin:8vh auto;background:#fff;border-radius:14px;padding:24px}}
h1{{font-size:22px;margin:0 0 12px}} p{{line-height:1.45;color:#57534e}}
input,button{{font:inherit;width:100%;box-sizing:border-box;padding:12px;border-radius:10px;margin-top:12px}}
input{{border:1px solid #d6d3d1}} button{{border:0;background:#1f1d1a;color:#fff}}
.error{{color:#b42318}}
@media (prefers-color-scheme:dark){{body{{background:#1c1b19;color:#f5f2ea}}main{{background:#2a2825}}p{{color:#a8a29e}}
input{{background:#1c1b19;color:#f5f2ea;border-color:#57534e}}button{{background:#f5f2ea;color:#1c1b19}}}}
</style></head><body><main>
<h1>Connect {e(client_name)} to Franki?</h1>
<p>It will be able to read and change your Anki collection: decks, notes, cards and study history.
After you connect, it returns to {e(redirect)}.</p>
{f'<p class="error">{e(error)}</p>' if error else ''}
<form method="post" action="/approve">
<input type="hidden" name="request" value="{e(request_id)}">
<input type="password" name="password" placeholder="MCP password" autocomplete="current-password" autofocus required>
<button type="submit">Connect</button>
</form></main></body></html>"""
        return HTMLResponse(body, headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer"})

    def _locked(self, source: str, now: float) -> str:
        """Why the page won't check a password from this source now, or "" when it will."""
        self._failures = {s: kept for s, times in self._failures.items() if (kept := [t for t in times if now - t < FAILURE_WINDOW])}
        self._all_failures = [t for t in self._all_failures if now - t < FAILURE_WINDOW_ALL]
        mine = self._failures.get(source, [])
        if len(mine) >= MAX_FAILURES:
            return f"Too many wrong passwords from your network. Try again in {_minutes(mine[-MAX_FAILURES] + FAILURE_WINDOW - now)}."
        if len(self._all_failures) >= MAX_FAILURES_ALL:
            wait = _minutes(self._all_failures[-MAX_FAILURES_ALL] + FAILURE_WINDOW_ALL - now)
            return f"Too many wrong passwords have been tried in the last few minutes. Try again in {wait}."
        return ""

    async def _pending(self, request_id: str):
        pending = self._get("pending", request_id) if request_id else None
        client = await self.get_client(pending["client_id"]) if pending else None
        return pending, client

    async def approve_page(self, request: Request) -> Response:
        request_id = request.query_params.get("request", "")
        pending, client = await self._pending(request_id)
        if not pending or not client:
            return HTMLResponse("<p>This sign-in link has expired. Start connecting again from Claude.</p>", status_code=400)
        redirect = urlparse(pending["params"]["redirect_uri"]).hostname or "the app"
        return self._page(request_id, client.client_name or "Claude", redirect)

    async def approve_submit(self, request: Request) -> Response:
        form = await request.form()
        request_id = str(form.get("request", ""))
        pending, client = await self._pending(request_id)
        if not pending or not client:
            return HTMLResponse("<p>This sign-in link has expired. Start connecting again from Claude.</p>", status_code=400)
        params = pending["params"]
        redirect_host = urlparse(params["redirect_uri"]).hostname or "the app"
        now = time.time()
        source = _source(request)
        # No await between this check and counting a wrong password, so requests sent at once can't all pass it.
        if locked := self._locked(source, now):
            return self._page(request_id, client.client_name or "Claude", redirect_host, locked)
        if not hmac.compare_digest(str(form.get("password", "")).encode(), self.password.encode()):
            self._failures.setdefault(source, []).append(now)
            self._all_failures.append(now)
            await anyio.sleep(WRONG_PASSWORD_DELAY)
            return self._page(request_id, client.client_name or "Claude", redirect_host, "That password isn't right.")
        self._take("pending", request_id)
        code = secrets.token_urlsafe(32)
        self._put("codes", _hash(code), {
            "scopes": params.get("scopes") or [], "expires_at": now + CODE_SECONDS,
            "client_id": client.client_id, "code_challenge": params["code_challenge"],
            "redirect_uri": params["redirect_uri"], "redirect_uri_provided_explicitly": params["redirect_uri_provided_explicitly"],
            "resource": params.get("resource"), "subject": "owner",
        }, now + CODE_SECONDS)
        return RedirectResponse(construct_redirect_uri(params["redirect_uri"], code=code, state=params.get("state")), status_code=302)

    # ---- tokens ----

    async def load_authorization_code(self, client: OAuthClientInformationFull, authorization_code: str) -> AuthorizationCode | None:
        data = self._get("codes", _hash(authorization_code))
        if not data or data["client_id"] != client.client_id:
            return None
        return AuthorizationCode.model_validate({**data, "code": authorization_code})

    async def exchange_authorization_code(self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode) -> OAuthToken:
        if not self._take("codes", _hash(authorization_code.code)):
            raise TokenError(error="invalid_grant", error_description="This code was already used.")
        return self._issue(client.client_id, authorization_code.scopes, authorization_code.resource)

    async def load_refresh_token(self, client: OAuthClientInformationFull, refresh_token: str) -> RefreshToken | None:
        data = self._get("refresh", _hash(refresh_token))
        if not data or data["client_id"] != client.client_id:
            return None
        return RefreshToken(token=refresh_token, client_id=data["client_id"], scopes=data["scopes"],
                            expires_at=int(data["expires_at"]), resource=data.get("resource"), subject="owner")

    async def exchange_refresh_token(self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]) -> OAuthToken:
        old = self._take("refresh", _hash(refresh_token.token))
        if not old:
            raise TokenError(error="invalid_grant", error_description="This refresh token was already used or revoked.")
        with self._lock:
            self._db.execute("delete from access where id = ?", (old["access"],))
        return self._issue(client.client_id, scopes or refresh_token.scopes, refresh_token.resource)

    def _issue(self, client_id: str, scopes: list[str], resource: str | None) -> OAuthToken:
        now = time.time()
        access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        self._put("access", _hash(access), {"client_id": client_id, "scopes": scopes, "expires_at": now + ACCESS_SECONDS,
                                            "resource": resource, "refresh": _hash(refresh)}, now + ACCESS_SECONDS)
        self._put("refresh", _hash(refresh), {"client_id": client_id, "scopes": scopes, "expires_at": now + REFRESH_SECONDS,
                                              "resource": resource, "access": _hash(access)}, now + REFRESH_SECONDS)
        return OAuthToken(access_token=access, token_type="Bearer", expires_in=ACCESS_SECONDS, refresh_token=refresh,
                          scope=" ".join(scopes) or None)

    async def load_access_token(self, token: str) -> AccessToken | None:
        data = self._get("access", _hash(token))
        if not data:
            return None
        return AccessToken(token=token, client_id=data["client_id"], scopes=data["scopes"], expires_at=int(data["expires_at"]),
                           resource=data.get("resource"), subject="owner")

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        h = _hash(token.token)
        for table, pair in (("access", "refresh"), ("refresh", "access")):
            data = self._take(table, h)
            if data:
                with self._lock:
                    self._db.execute(f"delete from {pair} where id = ?", (data[pair],))

