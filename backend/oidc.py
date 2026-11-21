"""Authorization Code OIDC bám luồng tham chiếu, bổ sung browser binding/PKCE/JWKS."""
import base64
import hashlib
import secrets
import time
from urllib.parse import urlencode, urlsplit
import jwt
from fastapi import HTTPException


def fail(code, message, status=400):
    """Trả lỗi có mã ổn định, không trả token/credential hoặc nội dung lỗi upstream."""
    raise HTTPException(status, detail={"code": code, "message": message})


class OidcClient:
    """Trao đổi code và chỉ công bố profile sau khi xác minh ID token."""
    def __init__(self, settings, client):
        """Nhận HTTP client dùng CA tin cậy và timeout đã cấu hình."""
        self.settings, self.client = settings, client
        self.metadata_cache = None
        self.metadata_until = 0
        self.keys = []
        self.keys_until = 0

    async def metadata(self):
        """Đọc discovery theo issuer mẫu; cho phép URL riêng nếu IdP có bố cục đặc thù."""
        s = self.settings
        if not s.idp_issuer or not s.idp_client_id or not s.idp_client_secret:
            fail("IDP_NOT_CONFIGURED", "Chưa cấu hình issuer/client của Single ID.", 503)
        if self.metadata_cache and time.time() < self.metadata_until:
            return self.metadata_cache
        url = s.idp_discovery_url or s.idp_issuer.rstrip("/") + "/.well-known/openid-configuration"
        response = await self.client.get(url)
        response.raise_for_status()
        data = response.json()
        if data.get("issuer") != s.idp_issuer:
            fail("ISSUER_MISMATCH", "Issuer trong discovery không khớp cấu hình.", 502)
        for name in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
            endpoint = s.idp_jwks_uri if name == "jwks_uri" and s.idp_jwks_uri else data.get(name, "")
            if urlsplit(endpoint).scheme != "https":
                fail("IDP_METADATA_INVALID", "Endpoint IdP phải dùng HTTPS.", 502)
            data[name] = endpoint
        self.metadata_cache, self.metadata_until = data, time.time() + 3600
        return data

    async def begin(self):
        """Tạo state/nonce riêng cho giao dịch; verifier không ra URL trình duyệt."""
        metadata = await self.metadata()
        transaction = {"nonce": secrets.token_urlsafe(32), "verifier": secrets.token_urlsafe(48)}
        state = secrets.token_urlsafe(32)
        params = dict(response_type="code", client_id=self.settings.idp_client_id,
                      redirect_uri=self.settings.callback_uri, scope=self.settings.idp_scope,
                      state=state, nonce=transaction["nonce"])
        if self.settings.idp_pkce_enabled:
            challenge = base64.urlsafe_b64encode(hashlib.sha256(transaction["verifier"].encode()).digest()).rstrip(b"=").decode()
            params.update(code_challenge=challenge, code_challenge_method="S256")
        separator = "&" if "?" in metadata["authorization_endpoint"] else "?"
        return state, transaction, metadata["authorization_endpoint"] + separator + urlencode(params)

    async def logout_location(self, session):
        """Dùng end_session_endpoint theo mẫu; ID token chỉ giữ trong Redis/backend."""
        metadata = await self.metadata()
        endpoint = metadata.get("end_session_endpoint", "")
        if urlsplit(endpoint).scheme != "https":
            fail("IDP_LOGOUT_NOT_CONFIGURED", "Discovery chưa có end_session_endpoint HTTPS hợp lệ.", 503)
        if not session.get("id_token_hint"):
            fail("IDP_LOGOUT_HINT_MISSING", "Phiên cũ chưa có dữ liệu logout. Bấm đăng nhập Single ID một lần rồi đăng xuất lại.", 409)
        params = dict(id_token_hint=session["id_token_hint"], post_logout_redirect_uri=self.settings.idp_logout_redirect or self.settings.public_origin + "/logout")
        return endpoint + ("&" if "?" in endpoint else "?") + urlencode(params)

    async def signing_key(self, kid):
        """Chọn khóa theo kid và nạp lại khi IdP rotate; không giữ cố định một khóa."""
        metadata = await self.metadata()
        if not self.keys or time.time() >= self.keys_until or not any(k.get("kid") == kid for k in self.keys):
            response = await self.client.get(metadata["jwks_uri"])
            response.raise_for_status()
            self.keys = response.json().get("keys", [])
            self.keys_until = time.time() + 3600
        key = next((k for k in self.keys if k.get("kid") == kid and k.get("use", "sig") == "sig"), None)
        if not key:
            fail("IDP_KEY_NOT_FOUND", "Không tìm được khóa ký của IdP.", 401)
        return jwt.PyJWK.from_dict(key, algorithm="RS256").key

    async def finish(self, code, transaction):
        """Đổi code đúng redirect_uri và xác minh JWT trước khi cấp cookie phiên ứng dụng."""
        s = self.settings
        metadata = await self.metadata()
        data = dict(grant_type="authorization_code", code=code, redirect_uri=s.callback_uri,
                    client_id=s.idp_client_id, client_secret=s.idp_client_secret)
        if s.idp_pkce_enabled:
            data["code_verifier"] = transaction["verifier"]
        response = await self.client.post(metadata["token_endpoint"], data=data)
        response.raise_for_status()
        tokens = response.json()
        try:
            header = jwt.get_unverified_header(tokens["id_token"])
            if header.get("alg") != "RS256" or not header.get("kid"):
                fail("ID_TOKEN_INVALID", "Thuật toán/kid ID token không hợp lệ.", 401)
            key = await self.signing_key(header["kid"])
            claims = jwt.decode(tokens["id_token"], key, algorithms=["RS256"], audience=s.idp_client_id,
                                issuer=s.idp_issuer, options={"require": ["exp", "iat", "iss", "aud", "sub", "nonce"]})
            if not secrets.compare_digest(str(claims["nonce"]), transaction["nonce"]):
                fail("NONCE_INVALID", "Nonce của phiên đăng nhập không khớp.", 401)
            aud = claims["aud"]
            if (isinstance(aud, list) and len(aud) > 1 and claims.get("azp") != s.idp_client_id) or (
                    claims.get("azp") and claims["azp"] != s.idp_client_id):
                fail("ID_TOKEN_INVALID", "Authorized party không khớp client.", 401)
            if claims.get("at_hash"):
                digest = hashlib.sha256(tokens["access_token"].encode()).digest()
                expected = base64.urlsafe_b64encode(digest[:len(digest)//2]).rstrip(b"=").decode()
                if not secrets.compare_digest(expected, claims["at_hash"]):
                    fail("ID_TOKEN_INVALID", "Access token không khớp ID token.", 401)
        except (jwt.PyJWTError, KeyError, ValueError):
            fail("ID_TOKEN_INVALID", "ID token không hợp lệ hoặc đã hết hạn.", 401)
        email = str(claims.get("email") or "").strip().casefold()
        domains = {d.strip().casefold() for d in s.allowed_email_domains.split(",") if d.strip()}
        if "@" not in email or (domains and email.rsplit("@", 1)[1] not in domains):
            fail("EMAIL_NOT_ALLOWED", "Email không thuộc phạm vi được cấp tài khoản SmartCall.", 403)
        if claims.get("email_verified") is False or (s.idp_require_verified_email and claims.get("email_verified") is not True):
            fail("EMAIL_NOT_VERIFIED", "IdP chưa xác nhận email.", 403)
        name = str(claims.get("formattedName") or claims.get("name") or claims.get("enFormattedName") or email)
        parts = name.split()
        profile = dict(name=name, email=email, department=claims.get("department") or claims.get("enDepartment") or "",
                       employee_id=claims.get("epId") or "", subject=claims["sub"],
                       firstname=claims.get("given_name") or parts[-1],
                       lastname=claims.get("family_name") or " ".join(parts[:-1]))
        ttl = min(s.session_ttl, int(claims["exp"] - time.time()))
        if ttl <= 0:
            fail("ID_TOKEN_EXPIRED", "Phiên IdP đã hết hạn.", 401)
        return dict(id_token_hint=tokens["id_token"], profile=profile, identity=claims["iss"] + "\0" + claims["sub"],
                    expires_at=int(time.time()) + ttl, csrf_token=secrets.token_urlsafe(32)), ttl
