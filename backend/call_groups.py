"""Lưu nhóm gọi cá nhân vào SQLite theo tenant và UUID đã xác minh."""
import asyncio
import json
import sqlite3
from contextlib import closing
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator


class CallGroupInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    members: list[UUID] = Field(min_length=2, max_length=100)

    # Lưu tên sau khi chuẩn hóa khoảng trắng và chặn tên rỗng.
    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Cần nhập tên nhóm.")
        return cleaned


# Chạy trong worker vì SQLite có thể chờ khóa ghi. UUID chủ không lấy từ request body.
def change_groups(path, owner, tenant, action, group=None, value=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path, timeout=5)) as db, db:
        db.execute("""CREATE TABLE IF NOT EXISTS saved_call_groups (
            id TEXT PRIMARY KEY, tenant TEXT NOT NULL, owner TEXT NOT NULL,
            name TEXT NOT NULL, members TEXT NOT NULL)""")
        db.execute("CREATE INDEX IF NOT EXISTS call_groups_owner ON saved_call_groups(tenant, owner)")
        if action == "list":
            rows = db.execute("""SELECT id, name, members FROM saved_call_groups
                WHERE tenant=? AND owner=? ORDER BY name COLLATE NOCASE,id""", (tenant, owner))
            return {"items": [dict(id=row[0], name=row[1], members=json.loads(row[2])) for row in rows]}
        if action == "delete":
            result = db.execute("DELETE FROM saved_call_groups WHERE id=? AND tenant=? AND owner=?", (group,tenant,owner))
            if result.rowcount != 1:
                raise HTTPException(404, "Không tìm thấy nhóm gọi.")
            return {"deleted": True}
        members = list(dict.fromkeys(str(member) for member in value.members if str(member) != owner))
        if len(members) < 2:
            raise HTTPException(422, "Chọn ít nhất hai đồng nghiệp khác nhau.")
        serialized = json.dumps(members)
        if group is None:
            group = str(uuid4())
            db.execute("INSERT INTO saved_call_groups VALUES (?,?,?,?,?)", (group,tenant,owner,value.name,serialized))
        else:
            result = db.execute("""UPDATE saved_call_groups SET name=?, members=?
                WHERE id=? AND tenant=? AND owner=?""", (value.name,serialized,group,tenant,owner))
            if result.rowcount != 1:
                raise HTTPException(404, "Không tìm thấy nhóm gọi.")
        return {"id": group, "name": value.name, "members": members}


# Tách I/O SQLite khỏi luồng xử lý HTTP và trả kết quả sau commit.
async def call_groups(path, owner, tenant, action, group=None, value=None):
    return await asyncio.to_thread(change_groups, path, owner, tenant, action, group, value)
