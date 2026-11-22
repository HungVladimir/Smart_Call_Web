"""Xử lý OIDC Authorization Code, xác minh ID token và tạo phiên Single ID."""
import base64
import hashlib
import secrets
import time
from urllib.parse import urlencode, urlsplit
import jwt
from fastapi import HTTPException


# Trả lỗi có mã ổn định, không trả token/credential hoặc nội dung lỗi upstream.
def fail(code, message, status=400):
    raise HTTPException(status, detail={"code": code, "message": message})


class OidcClient:
    """Trao đổi code và chỉ công bố profile sau khi xác minh ID token."""
    # Nhận HTTP client dùng CA tin cậy và timeout đã cấu hình.
    def __init__(self, settings, client):
        self.settings = settings
        self.client = client
        self.metadata_cache = None
        self.metadata_until = 0
        self.keys = []
        self.keys_until = 0

    # Đọc metadata OIDC từ issuer hoặc từ URL discovery cấu hình riêng.
    async def metadata(self):
        settings = self.settings
        if not settings.idp_issuer or not settings.idp_client_id or not settings.idp_client_secret:
            fail("IDP_NOT_CONFIGURED", "Chưa cấu hình issuer/client của Single ID.", 503)
        if self.metadata_cache and time.time() < self.metadata_until:
            return self.metadata_cache
        url = settings.idp_discovery_url or settings.idp_issuer.rstrip("/") + "/.well-known/openid-configuration"
        response = await self.client.get(url)
        response.raise_for_status()
        data = response.json()
        if data.get("issuer") != settings.idp_issuer:
            fail("ISSUER_MISMATCH", "Issuer trong discovery không khớp cấu hình.", 502)
        for name in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
            endpoint = settings.idp_jwks_uri if name == "jwks_uri" and settings.idp_jwks_uri else data.get(name, "")
            if urlsplit(endpoint).scheme != "https":
                fail("IDP_METADATA_INVALID", "Endpoint IdP phải dùng HTTPS.", 502)
            data[name] = endpoint
        self.metadata_cache, self.metadata_until = data, time.time() + 3600
        return data

    # Tạo state/nonce riêng cho giao dịch; verifier không ra URL trình duyệt.
    async def begin(self):
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

    # Tạo URL kết thúc phiên tại IdP từ metadata và ID token của phiên backend.
    async def logout_location(self, session):
        metadata = await self.metadata()
        endpoint = metadata.get("end_session_endpoint", "")
        if urlsplit(endpoint).scheme != "https":
            fail("IDP_LOGOUT_NOT_CONFIGURED", "Discovery chưa có end_session_endpoint HTTPS hợp lệ.", 503)
        if not session.get("id_token_hint"):
            fail("IDP_LOGOUT_HINT_MISSING", "Phiên cũ chưa có dữ liệu logout. Bấm đăng nhập Single ID một lần rồi đăng xuất lại.", 409)
        params = dict(id_token_hint=session["id_token_hint"], post_logout_redirect_uri=self.settings.idp_logout_redirect or self.settings.public_origin + "/logout")
        return endpoint + ("&" if "?" in endpoint else "?") + urlencode(params)

    # Chọn khóa theo kid và nạp lại khi IdP rotate; không giữ cố định một khóa.
    async def signing_key(self, kid):
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

    # Gửi authorization code và PKCE verifier tới token endpoint.
    async def exchange_code(self, code, transaction):
        settings = self.settings
        metadata = await self.metadata()
        data = dict(grant_type="authorization_code", code=code, redirect_uri=settings.callback_uri,
                    client_id=settings.idp_client_id, client_secret=settings.idp_client_secret)
        if settings.idp_pkce_enabled:
            data["code_verifier"] = transaction["verifier"]
        response = await self.client.post(metadata["token_endpoint"], data=data)
        response.raise_for_status()
        return response.json()

    # Xác thực chữ ký và ràng buộc token với giao dịch đăng nhập đã bắt đầu.
    async def validate_id_token(self, tokens, transaction):
        settings = self.settings
        try:
            header = jwt.get_unverified_header(tokens["id_token"])
            if header.get("alg") != "RS256" or not header.get("kid"):
                fail("ID_TOKEN_INVALID", "Thuật toán/kid ID token không hợp lệ.", 401)
            key = await self.signing_key(header["kid"])
            claims = jwt.decode(tokens["id_token"], key, algorithms=["RS256"], audience=settings.idp_client_id,
                                issuer=settings.idp_issuer, options={"require": ["exp", "iat", "iss", "aud", "sub", "nonce"]})
            if not secrets.compare_digest(str(claims["nonce"]), transaction["nonce"]):
                fail("NONCE_INVALID", "Nonce của phiên đăng nhập không khớp.", 401)
            audience = claims["aud"]
            authorized_party = claims.get("azp")
            multiple_audiences = isinstance(audience, list) and len(audience) > 1
            # Với nhiều audience, azp phải chỉ đúng client đã bắt đầu đăng nhập.
            if (multiple_audiences or authorized_party) and authorized_party != settings.idp_client_id:
                fail("ID_TOKEN_INVALID", "Authorized party không khớp client.", 401)
            if claims.get("at_hash"):
                digest = hashlib.sha256(tokens["access_token"].encode()).digest()
                expected = base64.urlsafe_b64encode(digest[:len(digest)//2]).rstrip(b"=").decode()
                if not secrets.compare_digest(expected, claims["at_hash"]):
                    fail("ID_TOKEN_INVALID", "Access token không khớp ID token.", 401)
        except (jwt.PyJWTError, KeyError, ValueError):
            fail("ID_TOKEN_INVALID", "ID token không hợp lệ hoặc đã hết hạn.", 401)
        return claims

    # Áp dụng chính sách email và chuẩn hóa các thuộc tính dùng trong SmartCall.
    def build_profile(self, claims):
        settings = self.settings
        email = str(claims.get("email") or "").strip().casefold()
        domains = {domain.strip().casefold() for domain in settings.allowed_email_domains.split(",") if domain.strip()}
        if "@" not in email or (domains and email.rsplit("@", 1)[1] not in domains):
            fail("EMAIL_NOT_ALLOWED", "Email không thuộc phạm vi được cấp tài khoản SmartCall.", 403)
        if claims.get("email_verified") is False or (settings.idp_require_verified_email and claims.get("email_verified") is not True):
            fail("EMAIL_NOT_VERIFIED", "IdP chưa xác nhận email.", 403)
        name = str(claims.get("formattedName") or claims.get("name") or claims.get("enFormattedName") or email)
        parts = name.split()
        return dict(name=name, email=email, department=claims.get("department") or claims.get("enDepartment") or "",
                       employee_id=claims.get("epId") or "", subject=claims["sub"],
                       firstname=claims.get("given_name") or parts[-1],
                       lastname=claims.get("family_name") or " ".join(parts[:-1]))

    # Hoàn tất đăng nhập và giới hạn phiên SmartCall theo hạn ID token.
    async def finish(self, code, transaction):
        tokens = await self.exchange_code(code, transaction)
        claims = await self.validate_id_token(tokens, transaction)
        profile = self.build_profile(claims)
        ttl = min(self.settings.session_ttl, int(claims["exp"] - time.time()))
        if ttl <= 0:
            fail("ID_TOKEN_EXPIRED", "Phiên IdP đã hết hạn.", 401)
        return dict(id_token_hint=tokens["id_token"], profile=profile, identity=claims["iss"] + "\0" + claims["sub"],
                    expires_at=int(time.time()) + ttl, csrf_token=secrets.token_urlsafe(32)), ttl
