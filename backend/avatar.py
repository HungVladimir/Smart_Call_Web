"""Proxy ảnh đại diện nội bộ từ máy chủ ảnh theo idKnox và kích thước chuẩn."""
import re
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from fastapi.responses import JSONResponse, Response

ALLOWED_AVATAR_SIZES = frozenset({"sm", "md", "lg", "xl", "org"})
AVATAR_ID_PATTERN = re.compile(r"^[a-zA-Z0-9._-]+$")
ALLOWED_IMAGE_TYPES = frozenset({
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
})
MAX_AVATAR_BYTES = 5 * 1024 * 1024


# Trích và xác thực phần trước @ từ email hoặc idKnox; chặn tuyệt đối path traversal và ký tự điều khiển.
def parse_avatar_id(raw_id: str) -> str:
    text = str(raw_id or "").strip()
    clean_id = text.split("@", 1)[0].strip() if "@" in text else text
    if not clean_id or len(clean_id) > 128 or clean_id in (".", "..") or not AVATAR_ID_PATTERN.match(clean_id):
        raise HTTPException(400, detail="Invalid avatar id")
    return clean_id


# Chuẩn hóa kích thước ảnh theo tập hợp được máy chủ ảnh nội bộ hỗ trợ.
def parse_avatar_size(raw_size: str) -> str:
    clean_size = str(raw_size or "sm").strip().lower()
    if clean_size not in ALLOWED_AVATAR_SIZES:
        raise HTTPException(400, detail="Invalid avatar size")
    return clean_size


# Dựng URL ảnh đích cố định trên host cấu hình, không để client tự chèn path hoặc query.
def build_avatar_upstream_url(base_url: str, clean_id: str, clean_size: str) -> str:
    clean_base = base_url.rstrip("/")
    return f"{clean_base}/api/file_handle/get_file/avatar/{quote(clean_id, safe='')}/avatar_{clean_size}.jpg"


# Đọc ảnh từ máy chủ nội bộ với kiểm tra Content-Type an toàn cho cả Web và App Android.
async def fetch_avatar(client: httpx.AsyncClient, settings, raw_id: str, raw_size: str):
    clean_id = parse_avatar_id(raw_id)
    clean_size = parse_avatar_size(raw_size)
    if not settings.avatar_base_url:
        return JSONResponse(status_code=503, content={"detail": "Avatar upstream not configured"})

    target_url = build_avatar_upstream_url(settings.avatar_base_url, clean_id, clean_size)
    try:
        upstream = await client.get(target_url)
    except httpx.TimeoutException:
        return JSONResponse(status_code=504, content={"detail": "Avatar upstream timeout"})
    except httpx.HTTPError:
        return JSONResponse(status_code=502, content={"detail": "Avatar upstream error"})

    if len(upstream.content) > MAX_AVATAR_BYTES:
        return JSONResponse(status_code=502, content={"detail": "Avatar image too large"})

    media_type = (upstream.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    if upstream.status_code == 200 and media_type in ALLOWED_IMAGE_TYPES:
        return Response(
            content=upstream.content,
            status_code=200,
            media_type=media_type,
            headers={
                "Cache-Control": "public, max-age=86400",
                "X-Content-Type-Options": "nosniff",
            },
        )

    if upstream.status_code in (200, 404) and media_type == "application/json":
        try:
            payload = upstream.json()
        except ValueError:
            payload = {"detail": "File not found"}
        if not isinstance(payload, (dict, list)):
            payload = {"detail": "File not found"}
        return JSONResponse(
            content=payload,
            status_code=upstream.status_code,
            headers={
                "Cache-Control": "public, max-age=300",
                "X-Content-Type-Options": "nosniff",
            },
        )

    if upstream.status_code == 404 or (upstream.status_code == 200 and media_type == "text/plain"):
        return JSONResponse(
            content={"detail": "File not found"},
            status_code=upstream.status_code,
            headers={
                "Cache-Control": "public, max-age=300",
                "X-Content-Type-Options": "nosniff",
            },
        )

    return JSONResponse(status_code=502, content={"detail": "Avatar upstream error"})
