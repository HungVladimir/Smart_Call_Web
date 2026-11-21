"""Nhập cấu hình liên quan từ bản dán backendV1 vào .env, không thực thi mã tham chiếu."""
import argparse
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
MAPPING = {
    "ONEAI_IDP__ISSUER": "SMARTCALL_IDP_ISSUER",
    "ONEAI_IDP__CLIENT_ID": "SMARTCALL_IDP_CLIENT_ID",
    "ONEAI_IDP__CLIENT_SECRET": "SMARTCALL_IDP_CLIENT_SECRET",
    "ONEAI_IDP__LOGOUT_REDIRECT": "SMARTCALL_IDP_LOGOUT_REDIRECT",
    "ONEAI_REDIS__URL": "SMARTCALL_REDIS_URL",
    "ONEAI_REDIS__TTL": "SMARTCALL_SESSION_TTL",
}


def assignments(text):
    """Chỉ đọc các dòng KEY=VALUE, không import/exec file Python dán từ dự án khác."""
    result = {}
    for line in text.splitlines():
        match = re.fullmatch(r"\s*([A-Z][A-Z0-9_]*)=(.*)", line)
        if match:
            value = match[2].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            result[match[1]] = value
    return result


def merge_reference(reference, existing, template):
    """Điền IdP/Redis từ mẫu; giữ nguyên Wazo/CA do người dùng đã nhập."""
    source = assignments(reference)
    # .env.example chỉ chứa mặc định không bí mật, dùng bổ sung tên biến còn thiếu.
    result = existing or template
    present = assignments(result)
    for name, value in assignments(template).items():
        if name not in present:
            result += "\n" + name + "=" + value
    imported = {}
    for old, new in MAPPING.items():
        if source.get(old):
            imported[new] = source[old]
    issuer = source.get("ONEAI_IDP__ISSUER", "").rstrip("/")
    if issuer:
        imported["SMARTCALL_IDP_DISCOVERY_URL"] = issuer + "/.well-known/openid-configuration"
        # URL ghi đè này có trong get_endpoint() của mã tham chiếu, không đoán từ tenant Wazo.
        imported["SMARTCALL_IDP_JWKS_URI"] = issuer.replace("/oauth2/token", "") + "/t/display.company/oauth2/jwks"
    callback = source.get("ONEAI_IDP__CALLBACK_URI")
    if callback:
        url = urlsplit(callback)
        if url.path != "/api/auth/callback" or url.scheme not in ("http", "https") or not url.netloc:
            raise ValueError("Callback mẫu không khớp /api/auth/callback; cần kiểm tra trước khi nhập.")
        imported["SMARTCALL_PUBLIC_ORIGIN"] = url.scheme + "://" + url.netloc
    for name, value in imported.items():
        line = name + "=" + json.dumps(value, ensure_ascii=False)
        pattern = re.compile(r"^\s*" + re.escape(name) + r"=.*$", re.MULTILINE)
        if pattern.search(result):
            result = pattern.sub(lambda match: line, result)
        else:
            result += "\n" + line
    return result.rstrip() + "\n", sorted(imported)


def main():
    """Ghi .env tại backend; chỉ in tên biến đã nhập, không in URL chứa mật khẩu hoặc secret."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, default=ROOT / "doc" / "backendV1.py")
    args = parser.parse_args()
    target = ROOT / ".env"
    text, names = merge_reference(
        args.reference.read_text(encoding="utf-8-sig"),
        target.read_text(encoding="utf-8-sig") if target.exists() else "",
        (ROOT / ".env.example").read_text(encoding="utf-8-sig"),
    )
    target.write_text(text, encoding="utf-8")
    print("Da nhap vao backend/.env (khong hien thi gia tri):")
    for name in names:
        print("  " + name)
    print("Can tu dien neu chua co: SMARTCALL_WAZO_ADMIN_USERNAME, SMARTCALL_WAZO_ADMIN_PASSWORD, SMARTCALL_WAZO_TENANT_UUID.")
    print("CA PEM chi can neu Python chua tin CA noi bo; context/template/kho so can xac nhan tren Wazo.")
    print(".env khong duoc dua len Git. Khoi dong lai backend sau khi nhap.")


if __name__ == "__main__":
    main()
