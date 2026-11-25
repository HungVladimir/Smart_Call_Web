"""Đối soát ngoại tuyến một lệnh pending. Dừng worker và sao lưu DB trước khi áp dụng."""
import argparse
import json
from pathlib import Path
from uuid import UUID

from chat_routes import finish, validate
from chat_store import ChatStore


# Kiểm tra biên nhận xuất từ Chatd và áp dụng thao tác cũ đúng một lần.
def reconcile(store, key, receipt, apply):
    with store.transaction(True) as db:
        rows=db.execute("SELECT * FROM operations WHERE key=? AND status='pending'",(str(UUID(key)),)).fetchall()
        if len(rows)!=1:
            raise ValueError("Cần đúng một thao tác pending khớp mã.")
        op=rows[0]
        tenant,user,g=op["tenant"],op["actor"],op["g"]
        who=(tenant,user,None)
        kind,_,payload,revision=json.loads(op["command"])
        if receipt.get("tenant_uuid")!=tenant:
            raise ValueError("Sai tenant.")
        snapshot=None if kind=="create" else store.snapshot(db,tenant,g,user)
        roster=validate(kind,snapshot,payload,who,revision)
        previous=snapshot["members"] if snapshot else []
        current=db.execute("SELECT room FROM groups WHERE id=?",(g,)).fetchone()
        room=current[0] if current else None
        result=receipt
        # Chỉ vận hành viên đã đối chiếu với log Wazo mới được quyết định lệnh không tới upstream.
        if receipt.get("verified_not_applied") is True:
            if not receipt.get("evidence_reference"):
                raise ValueError("Thiếu mã chứng cứ đối soát.")
            if apply:
                db.execute("UPDATE operations SET status='failed',result=? WHERE id=?",
                           (json.dumps({"evidence":receipt["evidence_reference"]}),op["id"]))
            return "failed"
        if kind=="send":
            if (not result.get("uuid") or not result.get("created_at") or result.get("user_uuid")!=user
                    or result.get("content")!=payload["content"] or result.get("room",{}).get("uuid")!=room):
                raise ValueError("Biên nhận tin không khớp phòng, người gửi hoặc nội dung.")
        elif kind in ("create","add","remove"):
            target=result.get("uuid")
            users=result.get("users",[])
            if (not target or sorted(person["uuid"] for person in users)!=roster
                    or any(person.get("tenant_uuid") not in (None,tenant) or person.get("identity") for person in users)):
                raise ValueError("Biên nhận phòng không khớp thành viên.")
            owner=db.execute("SELECT g FROM rooms WHERE tenant=? AND room=?",(tenant,target)).fetchone()
            if (owner and owner[0]!=g) or (not owner and result.get("name")!="SmartCall/"+op["id"]):
                raise ValueError("Không xác minh được quyền sở hữu phòng.")
        if apply:
            answer=finish(db,store,who,g,kind,payload,roster,previous,room,result)
            db.execute("UPDATE operations SET status='done',result=? WHERE id=?",(json.dumps(answer),op["id"]))
        return "done"


# Mặc định chỉ kiểm tra, --apply xác nhận sau khi vận hành đã so sánh bằng chứng.
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db",required=True,type=Path)
    parser.add_argument("--key",required=True)
    parser.add_argument("--receipt",required=True,type=Path)
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    if not args.db.is_file():
        parser.error("DB không tồn tại.")
    result=reconcile(ChatStore(args.db),args.key,json.loads(args.receipt.read_text(encoding="utf-8")),args.apply)
    print(("Đã đối soát" if args.apply else "Kết quả dự kiến"),result)


if __name__=="__main__":
    main()
