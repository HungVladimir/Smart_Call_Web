"""Cấu hình backend; bí mật chỉ đọc từ môi trường hoặc backend/.env."""
from pathlib import Path
from urllib.parse import urlsplit
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent


class Settings(BaseSettings):
    """Tập trung cấu hình IdP/Wazo; không mang dependency của dự án mẫu vào SmartCall."""
    model_config = SettingsConfigDict(env_prefix="SMARTCALL_", env_file=ROOT / ".env", extra="ignore", hide_input_in_errors=True)
    public_origin: str = "http://localhost:8800"
    idp_issuer: str = ""
    idp_client_id: str = ""
    idp_client_secret: str = ""
    idp_discovery_url: str = ""
    idp_jwks_uri: str = ""
    idp_logout_redirect: str = ""
    idp_scope: str = "openid"
    idp_pkce_enabled: bool = True
    idp_require_verified_email: bool = False
    allowed_email_domains: str = "samsung.com"
    redis_url: str = "redis://localhost:6379/0"
    redis_prefix: str = "smartcall"
    session_ttl: int = 3600
    database_path: Path = ROOT / "data" / "identity.sqlite3"
    tls_ca_file: str = ""
    wazo_url: str = "https://107.126.11.126:9443"
    wazo_admin_username: str = ""
    wazo_admin_password: str = ""
    wazo_tenant_uuid: str = ""
    wazo_provisioning_enabled: bool = True
    wazo_default_password: str = "12345"
    wazo_context: str = "internal"
    wazo_template_labels: str = "global,webrtc"
    wazo_extension_min: int = 1000
    wazo_extension_max: int = 9999
    wazo_existing_password_login: bool = False

    @model_validator(mode="after")
    def validate_configuration(self):
        """Chặn URL/số máy lẻ cấu hình sai trước khi có request cấp phát."""
        origin = urlsplit(self.public_origin)
        if origin.scheme not in ("http", "https") or not origin.netloc or origin.path not in ("", "/"):
            raise ValueError("PUBLIC_ORIGIN phải là origin, không kèm đường dẫn.")
        if origin.scheme == "http" and origin.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("Web trên IP/hostname công ty cần HTTPS để sử dụng microphone.")
        if urlsplit(self.wazo_url).scheme != "https":
            raise ValueError("WAZO_URL phải dùng HTTPS.")
        if not 1 <= self.wazo_extension_min <= self.wazo_extension_max <= 999999:
            raise ValueError("Dải máy lẻ không hợp lệ.")
        if self.idp_logout_redirect:
            target = urlsplit(self.idp_logout_redirect)
            if (target.scheme, target.netloc) != (origin.scheme, origin.netloc):
                raise ValueError("IDP_LOGOUT_REDIRECT phải cùng origin với Web.")
        self.public_origin = self.public_origin.rstrip("/")
        self.wazo_url = self.wazo_url.rstrip("/")
        return self

    @property
    def callback_uri(self):
        """URL backend nhận code; phải đăng ký chính xác giá trị này ở IdP."""
        return self.public_origin + "/api/auth/callback"

    @property
    def secure_cookie(self):
        """Cookie HTTPS được bật Secure; localhost HTTP là môi trường thử riêng."""
        return self.public_origin.startswith("https://")
