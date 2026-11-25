"""Tạo thuê bao Wazo giả theo lô để kiểm thử danh bạ. Mặc định chỉ xem trước."""
import argparse
import asyncio
import csv
import secrets
import ssl
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import HTTPException
from redis.exceptions import RedisError

from config import ROOT, Settings
from store import Store
from wazo import WazoClient

FIRST_NAMES = ("An", "Bình", "Chi", "Dũng", "Hà", "Hùng", "Lan", "Minh", "Quân", "Trang")
SURNAMES = ("Đặng", "Đỗ", "Hoàng", "Lê", "Nguyễn", "Phạm", "Phan", "Trần", "Võ", "Vũ")
DEPARTMENTS = ("QA Lab", "Support Lab", "Engineering Lab", "Operations Lab")
USERS_PATH = "/api/confd/1.1/users"


# Chọn số từ phần giao của cấu hình, dải thử nghiệm và user_ranges của Wazo.
def free_extensions(settings, context, existing, minimum, maximum):
    allowed_ranges = []
    for limits in context.get("user_ranges") or []:
        lower, upper = int(limits["start"]), int(limits["end"])
        if lower > upper:
            raise ValueError("Wazo trả user_ranges không hợp lệ.")
        allowed_ranges.append((lower, upper))
    used = {str(row["exten"]) for row in existing if row.get("context") == settings.wazo_context}
    lower = max(settings.wazo_extension_min, minimum or settings.wazo_extension_min)
    upper = min(settings.wazo_extension_max, maximum or settings.wazo_extension_max)
    return [
        str(number) for number in range(lower, upper + 1)
        if str(number) not in used
        and (not allowed_ranges or any(start <= number <= end for start, end in allowed_ranges))
    ]


# Dùng namespace riêng dễ tìm và bảo đảm máy lẻ không lặp trong cùng lô.
def make_accounts(count, available, batch):
    if count > len(available):
        raise ValueError(f"Cần {count} máy lẻ nhưng chỉ còn {len(available)} số phù hợp. Chưa tạo tài khoản nào.")
    for index, extension in enumerate(secrets.SystemRandom().sample(available, count), start=1):
        username = f"qa{batch}{index:04d}"
        yield {
            "username": username,
            "extension": extension,
            "firstname": secrets.choice(FIRST_NAMES),
            "lastname": "[QA] " + secrets.choice(SURNAMES),
            "email": username + "@example.invalid",
            "department": "TEST - " + secrets.choice(DEPARTMENTS),
        }


# Ghi nhật ký ngay trước và sau mỗi POST để nhận ra lượt chưa xác định nếu bị ngắt.
async def create_accounts(accounts, wazo, admin_token, templates, lock, batch):
    output = ROOT / "data" / f"seed-wazo-{batch}.csv"
    output.parent.mkdir(parents=True, exist_ok=True)
    fields = ["username", "firstname", "lastname", "email", "department", "extension", "status", "uuid"]
    with output.open("x", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        print(f"Nhật ký: {output}", flush=True)
        for index, account in enumerate(accounts, start=1):
            # Dùng cùng khóa với backend để tránh cấp trùng khi có người đăng nhập Single ID.
            if not await lock.owned() or not await lock.extend(180, replace_ttl=True):
                raise ValueError(f"Khóa cấp phát hết hạn. Đã xác nhận {index - 1}/{len(accounts)} tài khoản.")
            payload = wazo.build_user_payload(
                account, account["username"], f"smartcall:test:{batch}", templates, account["extension"],
            )
            payload["auth"]["password"] = secrets.token_urlsafe(24)
            # Kiểm tra đích danh tính trước khi tạo và dừng trước POST nếu dữ liệu đã tồn tại.
            if await wazo.find_email(account["email"], admin_token):
                raise ValueError(f"Email {account['email']} đã tồn tại. Đã xác nhận {index - 1} tài khoản.")
            # Lượt đọc email có thể chậm. Xác nhận lại khóa ngay trước khi ghi.
            if not await lock.owned():
                raise ValueError(f"Khóa cấp phát hết hạn. Đã xác nhận {index - 1} tài khoản.")
            writer.writerow(dict(account, status="pending", uuid=""))
            stream.flush()
            try:
                result = await wazo.request("POST", USERS_PATH, token=admin_token, json=payload)
                user_id = result.get("uuid")
                if not user_id:
                    raise ValueError("Wazo chưa trả UUID.")
            except (HTTPException, httpx.HTTPError, ValueError):
                raise ValueError(
                    f"Đã xác nhận {index - 1}/{len(accounts)} tài khoản. Kiểm tra {account['username']} "
                    "trên Wazo theo CSV trước khi chạy lô tiếp theo."
                ) from None
            writer.writerow(dict(account, status="created", uuid=user_id))
            stream.flush()
            print(f"[{index}/{len(accounts)}] {account['username']} · máy lẻ {account['extension']}", flush=True)


# Đọc cấu hình hiện có và đóng token/Redis kể cả khi Wazo từ chối một phần.
async def run(args):
    settings = Settings()
    if not all((settings.wazo_admin_username, settings.wazo_admin_password, settings.wazo_tenant_uuid)):
        raise ValueError("Cần credential quản trị và tenant Wazo trong cấu hình backend.")
    if args.apply and args.tenant != settings.wazo_tenant_uuid:
        raise ValueError("Khi ghi, --tenant phải khớp tenant Wazo đã cấu hình.")
    store = Store(settings)
    lock = store.redis.lock(store.key("provision", settings.wazo_tenant_uuid), timeout=180)
    locked = False
    ssl_context = ssl.create_default_context(cafile=settings.tls_ca_file or None)
    async with httpx.AsyncClient(verify=ssl_context, timeout=15, trust_env=False) as client:
        wazo = WazoClient(settings, client, store)
        admin = None
        try:
            if args.apply:
                locked = await lock.acquire(blocking=False)
                if not locked:
                    raise ValueError("Đang có lượt cấp tài khoản trên tenant này.")
            admin = await wazo.token(settings.wazo_admin_username, settings.wazo_admin_password, "smartcall-seed", user=False)
            token = admin["token"]
            context = await wazo.load_provisioning_context(token)
            templates = await wazo.load_sip_templates(token)
            existing = await wazo.list_items("/api/confd/1.1/extensions", token)
            available = free_extensions(settings, context, existing, args.min_extension, args.max_extension)
            batch = datetime.now(timezone.utc).strftime("%m%d") + uuid4().hex[:10]
            accounts = list(make_accounts(args.count, available, batch))
            print(f"Wazo {settings.wazo_url} | tenant {settings.wazo_tenant_uuid} | context {settings.wazo_context}")
            print(f"Lô {batch} · yêu cầu {len(accounts)} · còn {len(available)} máy lẻ phù hợp.")
            if args.apply:
                await create_accounts(accounts, wazo, token, templates, lock, batch)
            else:
                for account in accounts[:10]:
                    print(f"{account['firstname']} {account['lastname']} · {account['email']} · {account['extension']}")
                print("Xem trước tối đa 10 mẫu. Để tạo lô mới, chạy lại với --apply --tenant TENANT_UUID.")
        finally:
            try:
                if admin:
                    await client.delete(settings.wazo_url + "/api/auth/0.1/token/" + admin["token"])
            except httpx.HTTPError:
                print("Không thu hồi được token quản trị. Token sẽ hết hạn theo Wazo.")
            finally:
                try:
                    if locked and await lock.owned():
                        await lock.release()
                finally:
                    await store.redis.aclose()


# Đọc số lượng từ tham số hoặc hỏi trực tiếp nếu chạy script không kèm --count.
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int)
    parser.add_argument("--min-extension", type=int)
    parser.add_argument("--max-extension", type=int)
    parser.add_argument("--tenant", help="UUID tenant cần xác nhận khi dùng --apply")
    parser.add_argument("--apply", action="store_true", help="Ghi tài khoản lên tenant Wazo đã xác nhận")
    args = parser.parse_args()
    try:
        args.count = args.count if args.count is not None else int(input("Số tài khoản cần tạo: "))
        if args.count < 1:
            raise ValueError("Số lượng phải lớn hơn 0.")
        if not 1 <= (args.min_extension if args.min_extension is not None else 1) <= (args.max_extension if args.max_extension is not None else 999999) <= 999999:
            raise ValueError("Dải máy lẻ phải tăng dần và nằm trong 1–999999.")
        asyncio.run(run(args))
    except HTTPException as error:
        detail = error.detail
        parser.exit(1, f"{detail.get('message', 'Wazo từ chối yêu cầu.') if isinstance(detail, dict) else detail}\n")
    except (httpx.HTTPError, RedisError):
        parser.exit(1, "Không kết nối được Wazo hoặc Redis. Kiểm tra cấu hình và nhật ký lô.\n")
    except (ValueError, EOFError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
