"""Kho nhóm SmartCall. Mỗi giao dịch SQLite chỉ bao quanh thao tác cục bộ."""
import json
import sqlite3
from contextlib import contextmanager
from uuid import uuid4

from fastapi import HTTPException


# Trả lỗi nghiệp vụ thống nhất cho cả Android và Web.
def reject(status, code, message):
    raise HTTPException(status, {"code": code, "message": message})


# Tạo mã độc lập cho nhóm, activation và thao tác.
def new_id():
    return str(uuid4())


class ChatStore:
    # Tạo schema riêng trên volume dữ liệu, không ghi vào kho identity.
    def __init__(self, path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.transaction() as db:
            db.commit()
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY, tenant TEXT, title TEXT,
                    admin TEXT, revision INTEGER, active TEXT, room TEXT, closed INTEGER);
                CREATE TABLE IF NOT EXISTS members(g TEXT, u TEXT, active INTEGER, cutoff INTEGER,
                    PRIMARY KEY(g,u));
                CREATE INDEX IF NOT EXISTS member_groups ON members(u,g);
                CREATE TABLE IF NOT EXISTS rooms(tenant TEXT, room TEXT, g TEXT, PRIMARY KEY(tenant,room));
                CREATE TABLE IF NOT EXISTS activations(id TEXT PRIMARY KEY,g TEXT,room TEXT,roster TEXT);
                CREATE INDEX IF NOT EXISTS activation_group ON activations(g);
                CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, tenant TEXT, actor TEXT,
                    key TEXT, command TEXT, g TEXT, status TEXT, result TEXT, UNIQUE(tenant,actor,key));
                CREATE UNIQUE INDEX IF NOT EXISTS group_write ON operations(g) WHERE status='pending';
                CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY, g TEXT, activation TEXT,
                    room TEXT, source TEXT, author TEXT, created TEXT, content TEXT, UNIQUE(room,source));
                CREATE INDEX IF NOT EXISTS group_messages ON messages(g,seq);
                CREATE TABLE IF NOT EXISTS activity(seq INTEGER PRIMARY KEY, g TEXT, details TEXT);
                CREATE INDEX IF NOT EXISTS group_activity ON activity(g,seq);
                CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, g TEXT, kind TEXT, actor TEXT);
                CREATE TABLE IF NOT EXISTS notifications(seq INTEGER, u TEXT, PRIMARY KEY(u,seq));
                PRAGMA user_version=1;
            """)

    # Đóng kết nối kể cả khi có lỗi và rollback toàn bộ thay đổi trước khi trả lỗi.
    @contextmanager
    def transaction(self, write=False):
        db = sqlite3.connect(self.path, timeout=3)
        db.row_factory = sqlite3.Row
        try:
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield db
            db.commit()
        finally:
            db.close()

    # Chỉ cấp snapshot cho thành viên hiện tại hoặc người được đọc đến mốc đã rời.
    def snapshot(self, db, tenant, group, user):
        row = db.execute("""SELECT groups.*, members.active AS joined FROM groups JOIN members
            ON members.g=groups.id WHERE id=? AND tenant=? AND u=?""", (group, tenant, user)).fetchone()
        if not row:
            reject(404, "UNKNOWN_GROUP", "Không tìm thấy nhóm.")
        joined = bool(row["joined"])
        roster = self.roster(db, group) if joined else []
        known_rooms = [item[0] for item in db.execute("""SELECT DISTINCT room FROM activations
            WHERE g=? AND EXISTS (SELECT 1 FROM json_each(roster) WHERE value=?)""",(group,user))]
        last=db.execute("""SELECT seq,content,created FROM messages WHERE g=? AND
            (? OR seq<=(SELECT cutoff FROM members WHERE g=? AND u=?)) ORDER BY seq DESC LIMIT 1""",
            (group,joined,group,user)).fetchone()
        watermark=db.execute("""SELECT COALESCE(MAX(n.seq),0) FROM notifications n JOIN events e ON n.seq=e.seq
            WHERE n.u=? AND e.g=?""",(user,group)).fetchone()[0]
        return dict(groupId=group, managedRoomIds=known_rooms, version=watermark,
                    preview=last["content"] if last else "", lastMessageAt=last["created"] if last else None,
                    title=row["title"] if joined else "Nhóm đã rời",
                    adminUuid=row["admin"] if joined else None, revision=row["revision"] if joined else None,
                    activeActivationId=row["active"] if joined else None, members=roster,
                    capabilities=dict(send=joined and not row["closed"], manage=joined and not row["closed"] and row["admin"]==user),
                    status=("removed" if not joined else "closed" if row["closed"] else "active"))

    # Đọc danh sách hiện tại trong cùng transaction với lệnh kiểm tra quyền.
    def roster(self, db, group):
        return [row[0] for row in db.execute("SELECT u FROM members WHERE g=? AND active=1 ORDER BY u", (group,))]

    # Lưu tín hiệu đồng bộ theo đúng người nhận, kể cả người vừa bị gỡ.
    def notify(self, db, group, kind, actor, audience):
        seq = db.execute("INSERT INTO events(g,kind,actor) VALUES(?,?,?)", (group,kind,actor)).lastrowid
        db.executemany("INSERT INTO notifications VALUES(?,?)", [(seq,member_uuid) for member_uuid in audience])
        return seq

    # Chặn gửi bằng snapshot cũ và cấp độc quyền cho thao tác đang chờ ACK.
    def reserve(self, db, tenant, user, key, command, group):
        saved = db.execute("SELECT * FROM operations WHERE tenant=? AND actor=? AND key=?",
                           (tenant,user,key)).fetchone()
        if saved:
            if saved["command"] != command:
                reject(409, "KEY_CONFLICT", "Mã thao tác đã dùng cho nội dung khác.")
            if saved["status"] == "done":
                return None, json.loads(saved["result"])
            reject(409, "OPERATION_"+saved["status"].upper(), "Kiểm tra kết quả thao tác trước khi thử lại.")
        operation_id = new_id()
        try:
            db.execute("INSERT INTO operations VALUES(?,?,?,?,?,?,'pending',NULL)",
                       (operation_id,tenant,user,key,command,group))
        except sqlite3.IntegrityError:
            reject(409, "GROUP_BUSY", "Nhóm đang xử lý thao tác trước. Vui lòng tải lại.")
        return operation_id, None
