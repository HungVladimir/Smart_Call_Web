"""Nạp tài khoản Wazo từ CSV nhân viên. Chạy không tham số để mở cửa sổ chọn file."""
import argparse
import asyncio
import csv
import re
import secrets
import ssl
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import HTTPException
from redis.exceptions import RedisError

from config import ROOT, Settings
from store import Store
from wazo import WazoClient

# Sửa tên các cột ở đây nếu file xuất từ nguồn khác.
NAME_COLUMN = "Name"
EMAIL_COLUMN = "Email"
EMPLOYEE_ID_COLUMN = "ID"
DEPARTMENT_COLUMN = "Department"
EMAIL_DOMAIN = "samsung.com"
CSV_ENCODING = "utf-8-sig"
USERS_PATH = "/api/confd/1.1/users"


# Mở trình chọn CSV của Windows. Hủy chọn sẽ kết thúc trước khi kết nối Wazo.
def choose_csv():
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as error:
        raise ValueError("Python thiếu Tkinter. Hãy chạy lại với --csv đường_dẫn_file.") from error

    try:
        root = tk.Tk()
    except tk.TclError as error:
        raise ValueError("Không mở được cửa sổ chọn CSV. Hãy chạy lại với --csv đường_dẫn_file.") from error
    root.withdraw()
    try:
        path = filedialog.askopenfilename(title="Chọn CSV nhân viên", filetypes=[("CSV", "*.csv")])
        return Path(path) if path else None
    finally:
        root.destroy()


# Chuẩn hóa email để tên tài khoản và email sử dụng cùng định danh.
def company_email(value):
    username, separator, domain = value.strip().casefold().partition("@")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._+-]{0,63}", username) or username.endswith(".") or ".." in username:
        raise ValueError("Email hoặc tên email không hợp lệ.")
    if separator and domain != EMAIL_DOMAIN:
        raise ValueError(f"Email phải thuộc {EMAIL_DOMAIN}.")
    return username, f"{username}@{EMAIL_DOMAIN}"


# Đọc toàn bộ CSV trước khi gọi Wazo. Giữ ID dưới dạng chuỗi và chỉ báo số dòng khi lỗi.
def read_accounts(path):
    required = [NAME_COLUMN, EMAIL_COLUMN, EMPLOYEE_ID_COLUMN, DEPARTMENT_COLUMN]
    accounts, errors, seen_ids, seen_emails = [], [], set(), set()
    with path.open(encoding=CSV_ENCODING, newline="") as stream:
        sample = stream.readline()
        stream.seek(0)
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t").delimiter
        except csv.Error:
            delimiter = ","
        reader = csv.DictReader(stream, delimiter=delimiter, strict=True)
        headers = [header.strip() for header in (reader.fieldnames or [])]
        missing = [column for column in required if headers.count(column) != 1]
        if missing:
            raise ValueError(f"Mỗi cột phải xuất hiện đúng một lần: {', '.join(missing)}.")
        reader.fieldnames = headers
        for row in reader:
            line = reader.line_num
            if not any(value for key, value in row.items() if key is not None) and None not in row:
                continue
            try:
                if None in row or any(row.get(column) is None for column in required):
                    raise ValueError("Số cột không đúng. Đặt dữ liệu chứa dấu phân cách trong dấu ngoặc kép.")
                name = " ".join(row[NAME_COLUMN].split())
                employee_id = row[EMPLOYEE_ID_COLUMN].strip()
                department = " ".join(row[DEPARTMENT_COLUMN].split())
                if not name or not employee_id:
                    raise ValueError("Thiếu Name hoặc ID.")
                username, email = company_email(row[EMAIL_COLUMN])
                if email in seen_emails or employee_id in seen_ids:
                    raise ValueError("Trùng Email hoặc ID trong CSV.")
                seen_emails.add(email)
                seen_ids.add(employee_id)
                # Giữ thứ tự hiển thị họ tên mà mapper hiện tại ghép từ firstname rồi lastname.
                firstname, _, lastname = name.rpartition(" ")
                accounts.append(dict(line=line, username=username, email=email, employee_id=employee_id,
                                     firstname=firstname or lastname, lastname=lastname if firstname else "",
                                     department=department))
            except ValueError as error:
                errors.append(f"Dòng {line}: {error}")
    if errors:
        raise ValueError("\n".join(errors[:20]) + f"\nTổng cộng {len(errors)} dòng lỗi.")
    if not accounts:
        raise ValueError("CSV không có dòng nhân viên.")
    return accounts


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


# Chọn ngẫu nhiên các máy lẻ trống, không lặp trong cùng lô.
def assign_extensions(accounts, available):
    if len(accounts) > len(available):
        raise ValueError(f"Cần {len(accounts)} máy lẻ, chỉ còn {len(available)} số trống phù hợp.")
    chosen = secrets.SystemRandom().sample(available, len(accounts))
    return [dict(account, extension=extension) for account, extension in zip(accounts, chosen, strict=True)]


# Thoát sớm nếu người vận hành chưa xác nhận đúng đích Wazo.
def confirm_import(settings):
    print(f"Wazo: {settings.wazo_url} | tenant: {settings.wazo_tenant_uuid} | context: {settings.wazo_context}")
    return input("Nhập TAO để chạy tạo tài khoản trên Wazo: ").strip() == "TAO"


# Ghi CSV kết quả theo từng ACK. Trạng thái pending cho phép đối soát nếu mất kết nối sau POST.
async def create_accounts(accounts, skipped, wazo, token, templates, lock):
    output = ROOT / "data" / f"import-wazo-{uuid4().hex}.csv"
    output.parent.mkdir(parents=True, exist_ok=True)
    fields = ["line", "username", "employee_id", "email", "extension", "status", "uuid"]
    with output.open("x", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for account, existing in skipped:
            writer.writerow(dict(account, status="existing", uuid=existing.get("uuid", "")))
        stream.flush()
        print(f"Nhật ký: {output}", flush=True)
        for index, account in enumerate(accounts, start=1):
            # Cùng khóa cấp phát Single ID để tránh tranh máy lẻ ở hai luồng SmartCall.
            if not await lock.owned() or not await lock.extend(180, replace_ttl=True):
                raise ValueError(f"Khóa cấp phát hết hạn. Đã xác nhận {index - 1}/{len(accounts)} tài khoản.")
            payload = wazo.build_user_payload(account, account["username"], "", templates, account["extension"])
            payload.pop("userfield", None)
            payload["auth"]["password"] = secrets.token_urlsafe(24)
            writer.writerow(dict(account, status="pending"))
            stream.flush()
            try:
                result = await wazo.request("POST", USERS_PATH, token=token, json=payload)
                user_id = result.get("uuid")
                if not user_id:
                    raise ValueError("Wazo chưa trả UUID.")
            except (HTTPException, httpx.HTTPError, ValueError) as error:
                detail = error.detail if isinstance(error, HTTPException) else ""
                message = detail.get("message", "") if isinstance(detail, dict) else str(detail)
                raise ValueError(
                    f"Đã xác nhận {index - 1}/{len(accounts)} tài khoản. Đối soát dòng CSV "
                    f"{account['line']} trên Wazo trước khi chạy lại. {message}".strip()
                ) from None
            writer.writerow(dict(account, status="created", uuid=user_id))
            stream.flush()
            print(f"[{index}/{len(accounts)}] Đã tạo máy lẻ {account['extension']}.", flush=True)


# Dùng một phiên quản trị cho cả lô, kiểm tra trùng email rồi mới giữ khóa và đọc kho máy lẻ.
async def run(args, accounts):
    settings = Settings()
    if not settings.wazo_provisioning_enabled:
        raise ValueError("Cấp tài khoản Wazo đang tắt trong cấu hình backend.")
    if not all((settings.wazo_admin_username, settings.wazo_admin_password, settings.wazo_tenant_uuid)):
        raise ValueError("Cần cấu hình quản trị và tenant Wazo trong backend/.env.")
    verify = ssl.create_default_context(cafile=settings.tls_ca_file or None)
    store = Store(settings)
    lock = store.redis.lock(store.key("provision", settings.wazo_tenant_uuid), timeout=180)
    locked = False
    async with httpx.AsyncClient(verify=verify, timeout=15, trust_env=False) as client:
        wazo = WazoClient(settings, client, store)
        admin = None
        try:
            admin = await wazo.token(settings.wazo_admin_username, settings.wazo_admin_password, "smartcall-csv", user=False)
            token = admin["token"]
            context = await wazo.load_provisioning_context(token)
            templates = await wazo.load_sip_templates(token)
            pending, skipped = [], []
            for account in accounts:
                existing = await wazo.find_email(account["email"], token)
                if existing:
                    skipped.append((account, existing))
                else:
                    pending.append(account)
            extensions = await wazo.list_items("/api/confd/1.1/extensions", token)
            available = free_extensions(settings, context, extensions, args.min_extension, args.max_extension)
            print(f"Tenant {settings.wazo_tenant_uuid} · tạo {len(pending)} · bỏ qua {len(skipped)} · số trống {len(available)}.")
            if len(pending) > len(available):
                raise ValueError("Dải máy lẻ còn trống không đủ cho toàn bộ tài khoản mới.")
            if args.dry_run or not pending or not confirm_import(settings):
                return
            locked = await lock.acquire(blocking=False)
            if not locked:
                raise ValueError("Tenant đang cấp phát tài khoản. Vui lòng thử lại.")
            # Xác nhận lại tài khoản và số sau khi đã giữ khóa vì dữ liệu có thể đổi lúc xem trước.
            confirmed = []
            for account in pending:
                if not await lock.extend(180, replace_ttl=True):
                    raise ValueError("Khóa cấp phát hết hạn.")
                existing = await wazo.find_email(account["email"], token)
                if existing:
                    skipped.append((account, existing))
                else:
                    confirmed.append(account)
            extensions = await wazo.list_items("/api/confd/1.1/extensions", token)
            available = free_extensions(settings, context, extensions, args.min_extension, args.max_extension)
            await create_accounts(assign_extensions(confirmed, available), skipped, wazo, token, templates, lock)
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


# Chạy với cửa sổ chọn file hoặc truyền --csv khi dùng máy không có giao diện.
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, help="Đường dẫn CSV thay cho cửa sổ chọn file")
    parser.add_argument("--dry-run", action="store_true", help="Xem trước mà không tạo tài khoản")
    parser.add_argument("--min-extension", type=int)
    parser.add_argument("--max-extension", type=int)
    args = parser.parse_args()
    lower = args.min_extension if args.min_extension is not None else 1
    upper = args.max_extension if args.max_extension is not None else 999999
    if not 1 <= lower <= upper <= 999999:
        parser.error("Dải máy lẻ phải tăng dần và nằm trong 1–999999.")
    try:
        path = args.csv or choose_csv()
        if path is None:
            print("Đã hủy chọn CSV.")
            return
        asyncio.run(run(args, read_accounts(path)))
    except UnicodeError:
        parser.exit(1, "Không đọc được encoding của CSV. Hãy lưu dưới dạng CSV UTF-8.\n")
    except HTTPException as error:
        detail = error.detail
        parser.exit(1, f"{detail.get('message', 'Wazo từ chối yêu cầu.') if isinstance(detail, dict) else detail}\n")
    except (httpx.HTTPError, RedisError):
        parser.exit(1, "Không kết nối được Wazo hoặc Redis. Kiểm tra cấu hình và nhật ký lô.\n")
    except (ValueError, EOFError, OSError, csv.Error) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
