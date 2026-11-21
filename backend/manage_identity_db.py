"""Công cụ terminal xem/thêm/xóa mapping SQLite để test; không gọi Redis, IdP hoặc Wazo."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import sys
import uuid


SCHEMA = """CREATE TABLE IF NOT EXISTS identities (
    identity TEXT NOT NULL, tenant TEXT NOT NULL, user_uuid TEXT NOT NULL,
    username TEXT NOT NULL, managed INTEGER NOT NULL,
    PRIMARY KEY(identity, tenant), UNIQUE(tenant, user_uuid))"""


def build_parser():
    """Mô tả các lệnh và buộc lệnh ghi phải chỉ rõ bản ghi, không có lệnh xóa toàn bộ."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, help="Đường dẫn DB; mặc định đọc SMARTCALL_DATABASE_PATH/backend/.env.")
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="Xem mapping, tách identity thành issuer và subject.")
    listing.add_argument("--tenant")
    listing.add_argument("--username")
    adding = commands.add_parser("add", help="Thêm mapping mới; không sửa hoặc ghi đè liên kết đã có.")
    for field in ("issuer", "subject", "tenant", "user-uuid", "username"):
        adding.add_argument("--" + field, required=True)
    adding.add_argument("--managed", action="store_true", help="Chỉ bật nếu đây là tài khoản do SmartCall quản lý.")
    deleting = commands.add_parser("delete", help="Xóa mapping theo tenant + UUID Wazo; không xóa user trên Wazo.")
    deleting.add_argument("--tenant", required=True)
    deleting.add_argument("--user-uuid", required=True)
    return parser


def backup_database(database_path):
    """Sao lưu SQLite bằng API backup để có snapshot nhất quán, kể cả khi DB dùng WAL."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_path = database_path.with_name(database_path.name + ".backup-" + timestamp + "-" + uuid.uuid4().hex[:8])
    with closing(sqlite3.connect(database_path.as_uri() + "?mode=ro", uri=True)) as source:
        with closing(sqlite3.connect(backup_path)) as destination:
            source.backup(destination)
    return backup_path


def run(arguments):
    """Đọc an toàn hoặc ghi một mapping có backup; trả mã lỗi khác 0 nếu không thực hiện được."""
    if arguments.db is None:
        from config import Settings
        database_path = Settings().database_path.resolve()
    else:
        database_path = arguments.db.resolve()
    if not database_path.is_file() and arguments.command != "add":
        raise ValueError("Database chưa tồn tại: " + str(database_path))
    if arguments.command == "list":
        with closing(sqlite3.connect(database_path.as_uri() + "?mode=ro", uri=True)) as database:
            database.row_factory = sqlite3.Row
            query = "SELECT * FROM identities WHERE 1=1"
            parameters = []
            for column in ("tenant", "username"):
                value = getattr(arguments, column)
                if value is not None:
                    query += " AND " + column + "=?"
                    parameters.append(value)
            records = []
            for row in database.execute(query + " ORDER BY tenant, username", parameters):
                record = dict(row)
                issuer, separator, subject = record.pop("identity").partition("\0")
                record.update(issuer=issuer, subject=subject if separator else "", managed=bool(record["managed"]))
                records.append(record)
        print(json.dumps({"database": str(database_path), "items": records}, ensure_ascii=False, indent=2))
        return 0
    # Nên dừng backend khi test DB để phiên đang cấp phát không dùng mapping vừa bị sửa tay.
    fields = ("tenant", "user_uuid") if arguments.command == "delete" else ("issuer", "subject", "tenant", "user_uuid", "username")
    if any(not getattr(arguments, field).strip() or "\0" in getattr(arguments, field) for field in fields):
        raise ValueError("Các trường bắt buộc không được rỗng hoặc chứa ký tự NUL.")
    if database_path.exists():
        print("Backup: " + str(backup_database(database_path)))
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(database_path, timeout=10)) as database, database:
        if arguments.command == "add":
            database.execute(SCHEMA)
            database.execute("INSERT INTO identities VALUES (?, ?, ?, ?, ?)", (
                arguments.issuer + "\0" + arguments.subject, arguments.tenant,
                arguments.user_uuid, arguments.username, int(arguments.managed),
            ))
            print("Đã thêm 1 mapping. Tài khoản Wazo không bị tạo hoặc sửa bởi công cụ này.")
            return 0
        result = database.execute("DELETE FROM identities WHERE tenant=? AND user_uuid=?",
                                  (arguments.tenant, arguments.user_uuid))
        print("Đã xóa " + str(result.rowcount) + " mapping. Tài khoản Wazo không bị xóa.")
        return 0 if result.rowcount == 1 else 1


def main(argv=None):
    """Chuyển lỗi file/SQL thành thông báo terminal ngắn gọn, không in credential cấu hình."""
    arguments = build_parser().parse_args(argv)
    try:
        return run(arguments)
    except sqlite3.IntegrityError:
        print("Lỗi: danh tính hoặc UUID đã được liên kết; không ghi đè mapping cũ.", file=sys.stderr)
    except (sqlite3.Error, OSError, ValueError) as error:
        print("Lỗi: " + str(error), file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
