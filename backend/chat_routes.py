"""API nhóm SmartCall dùng chung cho Web và Android."""
import asyncio
import json
import re
from uuid import UUID
from typing import Annotated
from fastapi import APIRouter, Depends, Header, Query, Request, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from chat_store import new_id, reject
from chat_models import ActivityPage, Changes, GroupPage, GroupSnapshot, MessagePage, Operation, OriginalMessage

router = APIRouter(prefix="/api/chat/v1")
ROOMS = "/api/chatd/1.0/users/me/rooms"
KEY_HEADER = {"name":"Idempotency-Key","in":"header","required":True,"schema":{"type":"string","format":"uuid"}}
REV_HEADER = {"name":"If-Match","in":"header","required":True,"schema":{"type":"string"}}
ADMIN_HEADERS = {"parameters":[KEY_HEADER,REV_HEADER]}


class Title(BaseModel):
    title: str = Field(min_length=1, max_length=100)


class Members(BaseModel):
    memberUuids: list[UUID] = Field(min_length=1, max_length=99)


class Create(Title, Members):
    pass


class Transfer(BaseModel):
    targetUserUuid: UUID


class Message(BaseModel):
    content: str = Field(min_length=1, max_length=16000)
    clientMessageId: UUID
    expectedActivationId: UUID


# Kiểm tra token bằng Wazo tại host cấu hình trước khi đọc bất kỳ dữ liệu nào.
async def actor(request: Request, token: Annotated[str | None, Header(alias="X-Auth-Token")] = None):
    if not token or not re.fullmatch(r"[A-Za-z0-9._~-]{1,512}", token) or token in (".",".."):
        reject(401, "INVALID_TOKEN", "Cần token người dùng Wazo.")
    wazo = request.app.state.wazo
    response = await wazo.client.get(wazo.settings.wazo_url + "/api/auth/0.1/token/" + token,
                                     headers={"X-Auth-Token": token})
    if response.status_code != 200:
        reject(401 if response.status_code in (401,403,404) else 503, "AUTH_FAILED", "Chưa xác thực được phiên Wazo.")
    data = response.json().get("data", {})
    metadata = data.get("metadata") or {}
    tenant = metadata.get("tenant_uuid") or data.get("tenant_uuid")
    user = metadata.get("pbx_user_uuid")
    if not tenant or tenant != wazo.settings.wazo_tenant_uuid or not user:
        reject(403, "INVALID_ACTOR", "Cần danh tính thuê bao đúng tenant.")
    return tenant, user, token


Actor = Annotated[tuple, Depends(actor)]


# Liệt kê cả nhóm đã rời để người dùng đọc lại lịch sử được phép.
@router.get("/groups", response_model=GroupPage)
def groups(request: Request, identity: Actor, cursor: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
    store = request.app.state.chat
    with store.transaction() as db:
        rows = db.execute("""SELECT groups.rowid AS n,id FROM groups JOIN members ON members.g=id
            WHERE u=? AND tenant=? AND groups.rowid>? ORDER BY groups.rowid LIMIT ?""",
            (identity[1],identity[0],cursor,limit+1)).fetchall()
        return dict(items=[store.snapshot(db,identity[0],row["id"],identity[1]) for row in rows[:limit]],
                    nextCursor=rows[limit-1]["n"] if len(rows)>limit else None)


# Trả snapshot quyền hiện tại, dùng cả khi người dùng bấm gọi.
@router.get("/groups/{group}", response_model=GroupSnapshot)
def group_info(group: UUID, request: Request, identity: Actor):
    store = request.app.state.chat
    with store.transaction() as db:
        return store.snapshot(db,identity[0],str(group),identity[1])


# Phân trang theo sequence bền vững, giới hạn cứng tại mốc bị gỡ.
@router.get("/groups/{group}/messages", response_model=MessagePage)
def history(group: UUID, request: Request, identity: Actor, cursor: int = Query(2**63-1, ge=1, le=2**63-1),
            limit: int = Query(50, ge=1, le=100)):
    store = request.app.state.chat
    group = str(group)
    with store.transaction() as db:
        store.snapshot(db,identity[0],group,identity[1])
        rows = db.execute("""SELECT m.* FROM messages m JOIN members ON members.g=m.g
            WHERE m.g=? AND u=? AND seq<? AND (members.active=1 OR seq<=cutoff)
            ORDER BY seq DESC LIMIT ?""",(group,identity[1],cursor,limit+1)).fetchall()
        return dict(items=[dict(row) for row in reversed(rows[:limit])],
                    nextCursor=rows[limit-1]["seq"] if len(rows)>limit else None)


# Đọc nhật ký quản trị có phân trang và cùng mốc thu hồi quyền với tin nhắn.
@router.get("/groups/{group}/activity", response_model=ActivityPage)
def activity(group: UUID, request: Request, identity: Actor, cursor: int = Query(2**63-1,ge=1,le=2**63-1),
             limit: int = Query(50,ge=1,le=100)):
    group=str(group)
    store=request.app.state.chat
    with store.transaction() as db:
        store.snapshot(db,identity[0],group,identity[1])
        rows=db.execute("""SELECT e.seq,e.kind,e.actor,a.details FROM activity a JOIN events e ON e.seq=a.seq
            JOIN members m ON m.g=a.g WHERE m.u=? AND a.g=? AND a.seq<? AND (m.active=1 OR a.seq<=m.cutoff)
            ORDER BY a.seq DESC LIMIT ?""",(identity[1],group,cursor,limit+1)).fetchall()
        return dict(items=[dict(row,details=json.loads(row["details"])) for row in rows[:limit]],
                    nextCursor=rows[limit-1]["seq"] if len(rows)>limit else None)


# Cursor sự kiện riêng theo người nhận, hỗ trợ khôi phục khi mất kết nối.
@router.get("/changes", response_model=Changes)
def changes(request: Request, identity: Actor, cursor: int | None = Query(None, ge=0)):
    with request.app.state.chat.transaction() as db:
        if cursor is None:
            return dict(items=[],cursor=db.execute("SELECT COALESCE(MAX(seq),0) FROM events").fetchone()[0])
        rows=db.execute("""SELECT e.* FROM notifications n JOIN events e ON e.seq=n.seq
            JOIN groups ON groups.id=e.g WHERE n.u=? AND groups.tenant=? AND n.seq>? ORDER BY n.seq LIMIT 100""",
            (identity[1],identity[0],cursor)).fetchall()
        return dict(items=[dict(row) for row in rows],cursor=rows[-1]["seq"] if rows else cursor)


# Gửi một batch SSE rồi cho client nối lại bằng cursor. Nhánh timeout cũng đọc lại DB
# để bù trường hợp một worker khác vừa commit và không có tín hiệu trong process này.
@router.get("/events")
async def events(request: Request, identity: Actor, cursor: int | None = Query(None, ge=0)):
    if cursor is None and request.headers.get("Last-Event-ID"):
        try:
            cursor=int(request.headers["Last-Event-ID"])
        except ValueError:
            reject(422,"INVALID_CURSOR","Cursor không hợp lệ.")
    listeners=request.app.state.chat_listeners
    mailbox=asyncio.Event()
    key=(identity[0],identity[1])
    waiting=listeners.setdefault(key,set())
    waiting.add(mailbox)
    try:
        page=changes(request,identity,cursor)
        if cursor is not None and not page["items"]:
            try:
                await asyncio.wait_for(mailbox.wait(),timeout=12)
            except TimeoutError:
                pass
            page=changes(request,identity,cursor)
        content="id: "+str(page["cursor"])+"\ndata: "+json.dumps(page)+"\n\n"
        return Response(content,media_type="text/event-stream",headers={"X-Accel-Buffering":"no"})
    finally:
        waiting.discard(mailbox)
        if not waiting:
            listeners.pop(key,None)


# Tra kết quả thao tác mà chính tài khoản đã gửi.
@router.get("/operations/{key}", response_model=Operation)
def operation(key: UUID, request: Request, identity: Actor):
    with request.app.state.chat.transaction() as db:
        row=db.execute("SELECT status,result FROM operations WHERE tenant=? AND actor=? AND key=?",
                       (identity[0],identity[1],str(key))).fetchone()
        if not row:
            reject(404,"UNKNOWN_OPERATION","Không tìm thấy thao tác.")
        return dict(status=row["status"],result=json.loads(row["result"]) if row["result"] else None)


# Kiểm tra quyền và tính toàn bộ tập thành viên đích trong transaction ban đầu.
def validate(kind, snapshot, payload, identity, revision):
    user=identity[1]
    roster=set(snapshot["members"]) if snapshot else {user}
    if snapshot:
        if snapshot["status"]!="active":
            reject(403,"GROUP_READ_ONLY","Nhóm chỉ cho phép đọc.")
        if kind=="send":
            if snapshot["activeActivationId"]!=payload["expectedActivationId"]:
                reject(409,"STALE_ROOM","Thành viên đã thay đổi. Vui lòng tải lại.")
        elif snapshot["adminUuid"]!=user:
            reject(403,"ADMIN_REQUIRED","Chỉ quản trị viên được thao tác.")
        elif revision!=str(snapshot["revision"]):
            reject(409,"STALE_REVISION","Nhóm vừa thay đổi. Vui lòng tải lại.")
    if kind in ("create","rename"):
        title=payload["title"]
        if not title.strip() or any(ord(c)<32 for c in title):
            reject(422,"INVALID_TITLE","Tên nhóm không hợp lệ.")
    if kind=="send" and not payload["content"].strip():
        reject(422,"EMPTY_MESSAGE","Tin nhắn trống.")
    if kind in ("create","add"):
        roster.update(payload["memberUuids"])
    if kind=="remove":
        target=payload["user"]
        if target==user or target not in roster:
            reject(422,"INVALID_MEMBER","Không thể gỡ người này.")
        roster.remove(target)
    if kind=="transfer" and payload["targetUserUuid"] not in roster:
        reject(422,"INVALID_ADMIN","Admin mới phải thuộc nhóm.")
    if not 3<=len(roster)<=100:
        reject(422,"GROUP_SIZE","Nhóm cần từ 3 đến 100 thành viên.")
    return sorted(roster)


# Xác nhận upstream bằng token tác giả và đối chiếu nguồn trước khi ghi DB.
async def upstream(request, identity, kind, payload, roster, group, room, operation_id):
    if kind not in ("send","create","add","remove"):
        return {}
    store=request.app.state.chat
    wazo=request.app.state.wazo
    if kind=="send":
        path=ROOMS+"/"+room+"/messages"
        body={"content":payload["content"]}
    else:
        path=ROOMS
        body={"name":"SmartCall/"+operation_id,"users":[{"uuid":member_uuid} for member_uuid in roster]}
    response=await wazo.client.post(wazo.settings.wazo_url+path,json=body,
                                    headers={"X-Auth-Token":identity[2],"Wazo-Tenant":identity[0]})
    if 400<=response.status_code<500 and response.status_code!=408:
        reject(409,"WAZO_REJECTED","Wazo từ chối thao tác.")
    if not response.is_success:
        reject(503,"UNCERTAIN","Chưa xác định kết quả trên Wazo.")
    result=response.json()
    if kind=="send":
        source_room=result.get("room") or {}
        if (result.get("tenant_uuid") not in (None,identity[0]) or source_room.get("uuid") not in (None,room)
                or not result.get("uuid") or not result.get("created_at")
                or result.get("user_uuid")!=identity[1] or result.get("content")!=payload["content"]):
            reject(503,"UNCERTAIN","Chưa đối chiếu được tin nhắn gốc.")
        return result
    room=result.get("uuid")
    users=result.get("users",[])
    if result.get("tenant_uuid") not in (None,identity[0]) or not room or sorted(person.get("uuid","") for person in users)!=roster or any(
        person.get("tenant_uuid") not in (None,identity[0]) or person.get("identity") for person in users):
        reject(409,"INVALID_ROOM","Thành viên hoặc tenant phòng Wazo không khớp.")
    with store.transaction() as db:
        owner=db.execute("SELECT g FROM rooms WHERE tenant=? AND room=?",(identity[0],room)).fetchone()
    if (owner and owner[0]!=group) or (not owner and result.get("name")!=body["name"]):
        reject(409,"ROOM_OWNERSHIP_CONFLICT","Phòng Wazo đã thuộc hội thoại khác.")
    return result


# Hoàn tất activation, lịch sử và sự kiện trong cùng transaction với kết quả trả client.
def finish(db,store,identity,group_id,kind,payload,roster,previous,room,result):
    tenant,user,_=identity
    seq=store.notify(db,group_id,kind,user,set(roster)|set(previous))
    if kind=="send":
        row=db.execute("SELECT active FROM groups WHERE id=?",(group_id,)).fetchone()
        db.execute("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)",(seq,group_id,row[0],room,result["uuid"],user,result["created_at"],result["content"]))
        return dict(db.execute("SELECT * FROM messages WHERE seq=?",(seq,)).fetchone())
    details = dict(payload)
    if kind in ("create","add"):
        details["memberUuids"]=sorted(set(roster)-set(previous))
    db.execute("INSERT INTO activity VALUES(?,?,?)",(seq,group_id,json.dumps(details)))
    if kind in ("create","add","remove"):
        room=result["uuid"]
        activation=new_id()
        db.execute("INSERT OR IGNORE INTO rooms VALUES(?,?,?)",(tenant,room,group_id))
        if db.execute("SELECT g FROM rooms WHERE tenant=? AND room=?",(tenant,room)).fetchone()[0]!=group_id:
            reject(409,"ROOM_OWNERSHIP_CONFLICT","Phòng thuộc nhóm khác.")
        if kind=="create":
            db.execute("INSERT INTO groups VALUES(?,?,?,?,0,?,?,0)",(group_id,tenant,payload["title"].strip(),user,activation,room))
        db.execute("UPDATE groups SET active=?,room=? WHERE id=?",(activation,room,group_id))
        db.execute("INSERT INTO activations VALUES(?,?,?,?)",(activation,group_id,room,json.dumps(roster)))
        for member in roster:
            db.execute("INSERT OR REPLACE INTO members VALUES(?,?,1,NULL)",(group_id,member))
        for member in set(previous)-set(roster):
            db.execute("UPDATE members SET active=0,cutoff=? WHERE g=? AND u=?",(seq,group_id,member))
    elif kind=="rename":
        db.execute("UPDATE groups SET title=? WHERE id=?",(payload["title"].strip(),group_id))
    elif kind=="transfer":
        db.execute("UPDATE groups SET admin=? WHERE id=?",(payload["targetUserUuid"],group_id))
    elif kind=="close":
        db.execute("UPDATE groups SET closed=1 WHERE id=?",(group_id,))
    db.execute("UPDATE groups SET revision=revision+1 WHERE id=?",(group_id,))
    return store.snapshot(db,tenant,group_id,user)


# Giữ hàng rào ghi khi timeout chưa rõ kết quả để tránh gửi trùng hoặc chuyển sai phòng.
async def execute(request,identity,kind,group_id,payload):
    store=request.app.state.chat
    tenant,user,_=identity
    if request.app.state.wazo.settings.chat_read_only:
        reject(503,"CHAT_READ_ONLY","Nhóm đang ở chế độ chỉ đọc.")
    key=payload.get("clientMessageId") or request.headers.get("Idempotency-Key","")
    try:
        UUID(key)
    except ValueError:
        reject(422,"INVALID_KEY","Cần mã thao tác UUID.")
    revision=request.headers.get("If-Match")
    command=json.dumps([kind,group_id,payload,revision],sort_keys=True)
    group_id=group_id or new_id()
    with store.transaction(True) as db:
        operation_id,replay=store.reserve(db,tenant,user,key,command,group_id)
        if replay is not None:
            return replay
        snapshot=None if kind=="create" else store.snapshot(db,tenant,group_id,user)
        roster=validate(kind,snapshot,payload,identity,revision)
        previous=snapshot["members"] if snapshot else []
        if kind=="add" and roster==sorted(previous):
            reject(422,"NO_NEW_MEMBERS","Hãy chọn thêm thành viên mới.")
        room=db.execute("SELECT room FROM groups WHERE id=?",(group_id,)).fetchone()[0] if snapshot else None
    try:
        result=await upstream(request,identity,kind,payload,roster,group_id,room,operation_id)
        with store.transaction(True) as db:
            answer=finish(db,store,identity,group_id,kind,payload,roster,previous,room,result)
            db.execute("UPDATE operations SET status='done', result=? WHERE id=?",(json.dumps(answer),operation_id))
        # Đánh thức đúng phiên đang nghe sau commit để đọc được snapshot mới.
        for member in set(roster)|set(previous):
            for mailbox in request.app.state.chat_listeners.get((tenant,member),()):
                mailbox.set()
        return answer
    except HTTPException as error:
        if error.status_code<500:
            with store.transaction(True) as db:
                db.execute("UPDATE operations SET status='failed' WHERE id=?",(operation_id,))
        raise


# Tạo nhóm mới và chỉ công bố sau ACK từ Wazo.
@router.post("/groups", response_model=GroupSnapshot, openapi_extra={"parameters":[KEY_HEADER]})
async def create(request: Request, identity: Actor, body: Create):
    return await execute(request,identity,"create",None,body.model_dump(mode="json"))


# Chuyển phòng khi thêm nhiều thành viên trong một lần.
@router.post("/groups/{group}/members", response_model=GroupSnapshot, openapi_extra=ADMIN_HEADERS)
async def add(group: UUID, request: Request, identity: Actor, body: Members):
    return await execute(request,identity,"add",str(group),body.model_dump(mode="json"))


# Chuyển phòng khi gỡ một thành viên.
@router.delete("/groups/{group}/members/{user}", response_model=GroupSnapshot, openapi_extra=ADMIN_HEADERS)
async def remove(group: UUID,user: UUID,request: Request,identity: Actor):
    return await execute(request,identity,"remove",str(group),{"user":str(user)})


# Đổi tên nhóm logic và giữ nguyên phòng vật lý.
@router.patch("/groups/{group}", response_model=GroupSnapshot, openapi_extra=ADMIN_HEADERS)
async def rename(group: UUID,request: Request,identity: Actor, body: Title):
    return await execute(request,identity,"rename",str(group),body.model_dump())


# Chuyển quyền nguyên tử cho thành viên hiện tại.
@router.post("/groups/{group}/admin-transfer", response_model=GroupSnapshot, openapi_extra=ADMIN_HEADERS)
async def transfer(group: UUID,request: Request,identity: Actor, body: Transfer):
    return await execute(request,identity,"transfer",str(group),body.model_dump(mode="json"))


# Khóa ghi cho toàn bộ nhóm, còn quyền đọc lịch sử.
@router.post("/groups/{group}/close", response_model=GroupSnapshot, openapi_extra=ADMIN_HEADERS)
async def close(group: UUID,request: Request,identity: Actor):
    return await execute(request,identity,"close",str(group),{})


# Gửi tin bằng danh tính Wazo của người đang gọi API.
@router.post("/groups/{group}/messages", response_model=OriginalMessage)
async def send(group: UUID,request: Request,identity: Actor, body: Message):
    return await execute(request,identity,"send",str(group),body.model_dump(mode="json"))
