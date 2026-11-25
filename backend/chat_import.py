"""Nạp manifest lịch sử đã được vận hành xác minh. Mặc định chỉ kiểm tra nội dung."""
import argparse
import json
from datetime import datetime
from pathlib import Path
from uuid import UUID
from chat_store import ChatStore, new_id


# Kiểm tra và nạp cả nhóm trong một transaction để không công bố lịch sử thiếu.
def import_group(store, manifest, apply=False):
    group=str(UUID(manifest["groupId"]))
    tenant=str(UUID(manifest["tenantUuid"]))
    admin=str(UUID(manifest["adminUuid"]))
    title=manifest["title"].strip()
    periods=manifest["activations"]
    if not manifest.get("reviewedSource") or not periods or not 1<=len(title)<=100:
        raise ValueError("Cần xác minh nguồn, admin, tên và từng giai đoạn.")
    total=0
    with store.transaction(True) as db:
        if db.execute("SELECT 1 FROM groups WHERE id=?",(group,)).fetchone():
            raise ValueError("Nhóm đã được nạp.")
        db.execute("INSERT INTO groups VALUES(?,?,?,?,1,'','',0)",(group,tenant,title,admin))
        previous=set()
        for period in periods:
            room=str(UUID(period["roomId"]))
            roster={str(UUID(member_uuid)) for member_uuid in period["members"]}
            if not 3<=len(roster)<=100 or len(roster)!=len(period["members"]):
                raise ValueError("Roster không hợp lệ.")
            db.execute("INSERT OR IGNORE INTO rooms VALUES(?,?,?)",(tenant,room,group))
            if db.execute("SELECT g FROM rooms WHERE tenant=? AND room=?",(tenant,room)).fetchone()[0]!=group:
                raise ValueError("Phòng thuộc nhóm khác.")
            activation=new_id()
            db.execute("INSERT INTO activations VALUES(?,?,?,?)",(activation,group,room,json.dumps(sorted(roster))))
            db.execute("UPDATE groups SET active=?,room=? WHERE id=?",(activation,room,group))
            # Lưu sự kiện mốc, không tăng badge cho tin lịch sử được backfill.
            boundary=store.notify(db,group,"membership",admin,previous|roster)
            for member_uuid in previous-roster:
                db.execute("UPDATE members SET active=0,cutoff=? WHERE g=? AND u=?",(boundary,group,member_uuid))
            for member_uuid in roster:
                db.execute("INSERT OR REPLACE INTO members VALUES(?,?,1,NULL)",(group,member_uuid))
            rows=period["messages"]
            if len(rows)!=period["expectedCount"]:
                raise ValueError("Thiếu tin so với bản kiểm kê.")
            for message in rows:
                if (message["room"]["uuid"]!=room or message["user_uuid"] not in roster
                        or message.get("tenant_uuid")!=tenant or not isinstance(message["content"],str)):
                    raise ValueError("Nguồn tin không khớp.")
                datetime.fromisoformat(message["created_at"])
                seq=db.execute("INSERT INTO events(g,kind,actor) VALUES(?,?,?)",
                               (group,"import",message["user_uuid"])).lastrowid
                db.execute("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)",(seq,group,activation,room,
                    str(UUID(message["uuid"])),message["user_uuid"],message["created_at"],message["content"]))
                total+=1
            previous=roster
        if admin not in previous:
            raise ValueError("Admin phải còn trong nhóm.")
        if not apply:
            db.rollback()
    return total


# Chạy ngoại tuyến với manifest JSON UTF-8 sau khi kiểm kê và sao lưu.
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db",type=Path,required=True)
    parser.add_argument("--manifest",type=Path,required=True)
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    count=import_group(ChatStore(args.db),json.loads(args.manifest.read_text(encoding="utf-8")),args.apply)
    print("Đã nạp" if args.apply else "Đã kiểm tra",count,"tin nhắn.")


if __name__=="__main__":
    main()
