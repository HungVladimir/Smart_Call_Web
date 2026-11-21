"""Redis giữ phiên ngắn hạn; SQLite chỉ lưu liên kết danh tính, không lưu mật khẩu."""
from contextlib import closing
import asyncio
import json
import sqlite3
from redis.asyncio import Redis


class Store:
    """Đóng gói dữ liệu phiên và mapping bền vững theo issuer/sub/tenant."""
    def __init__(self, settings):
        """Khởi tạo client; chưa kết nối Redis khi import module."""
        self.settings = settings
        self.redis = Redis.from_url(settings.redis_url, decode_responses=True,
                                    socket_timeout=5, socket_connect_timeout=5)

    def key(self, resource, identifier):
        """Tách namespace SmartCall khỏi dự án tham chiếu đang dùng cùng Redis."""
        return f"{self.settings.redis_prefix}:{resource}:{identifier}"

    async def get(self, resource, identifier, consume=False):
        """Đọc JSON; giao dịch OIDC được lấy và xóa nguyên tử để chống replay."""
        if not identifier:
            return None
        key = self.key(resource, identifier)
        data = await (self.redis.getdel(key) if consume else self.redis.get(key))
        return json.loads(data) if data else None

    async def put(self, resource, identifier, value, ttl):
        """Mọi dữ liệu phiên đều có thời hạn; không tạo key sống vô hạn."""
        await self.redis.set(self.key(resource, identifier), json.dumps(value), ex=max(1, int(ttl)))

    async def delete(self, resource, identifier):
        """Xóa phiên server khi đăng xuất; không đụng mapping tài khoản."""
        if identifier:
            await self.redis.delete(self.key(resource, identifier))

    def _mapping(self, identity, tenant, value=None):
        """Thao tác SQLite có unique constraint; chạy trong worker để tránh chặn event loop."""
        path = self.settings.database_path
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path, timeout=10)) as db, db:
            db.row_factory = sqlite3.Row
            db.execute("""CREATE TABLE IF NOT EXISTS identities (
                identity TEXT NOT NULL, tenant TEXT NOT NULL, user_uuid TEXT NOT NULL,
                username TEXT NOT NULL, managed INTEGER NOT NULL,
                PRIMARY KEY(identity, tenant), UNIQUE(tenant, user_uuid))""")
            if value:
                db.execute("INSERT INTO identities VALUES (?, ?, ?, ?, ?)",
                           (identity, tenant, value["user_uuid"], value["username"], int(value["managed"])))
            row = db.execute("SELECT * FROM identities WHERE identity=? AND tenant=?",
                             (identity, tenant)).fetchone()
            return dict(row) if row else None

    async def mapping(self, identity, tenant, value=None):
        """Đọc/ghi mapping ngoài event loop; không lưu token hoặc credential vào SQLite."""
        return await asyncio.to_thread(self._mapping, identity, tenant, value)


    def _replace_mapping(self, identity, tenant, expected_user_uuid, value):
        """Thay binding cũ theo UUID kỳ vọng trong một transaction; không ghi đè sửa đổi khác."""
        with closing(sqlite3.connect(self.settings.database_path, timeout=10)) as database, database:
            result = database.execute(
                "UPDATE identities SET user_uuid=?, username=?, managed=? "
                "WHERE identity=? AND tenant=? AND user_uuid=?",
                (value["user_uuid"], value["username"], int(value["managed"]),
                 identity, tenant, expected_user_uuid),
            )
            if result.rowcount != 1:
                from oidc import fail
                fail("WAZO_MAPPING_CHANGED", "Liên kết tài khoản vừa thay đổi; vui lòng đăng nhập lại.", 409)

    async def replace_mapping(self, identity, tenant, expected_user_uuid, value):
        """Cập nhật UUID mới sau khi Wazo xác nhận UUID đã liên kết không còn tồn tại."""
        await asyncio.to_thread(self._replace_mapping, identity, tenant, expected_user_uuid, value)
