"""Schema trả về của API nhóm để Android và Web dùng cùng hợp đồng OpenAPI."""
from typing import Literal
from uuid import UUID
from pydantic import BaseModel


class GroupPermissions(BaseModel):
    send: bool
    manage: bool


class GroupSnapshot(BaseModel):
    groupId: UUID
    title: str
    adminUuid: UUID | None
    revision: int | None
    activeActivationId: UUID | None
    members: list[UUID]
    managedRoomIds: list[UUID]
    version: int
    preview: str
    lastMessageAt: str | None
    capabilities: GroupPermissions
    status: Literal["active", "removed", "closed"]


class GroupPage(BaseModel):
    items: list[GroupSnapshot]
    nextCursor: int | None


class OriginalMessage(BaseModel):
    seq: int
    g: UUID
    activation: UUID
    room: UUID
    source: UUID
    author: UUID
    created: str
    content: str


class MessagePage(BaseModel):
    items: list[OriginalMessage]
    nextCursor: int | None


class GroupChange(BaseModel):
    seq: int
    g: UUID
    kind: str
    actor: UUID


class Changes(BaseModel):
    cursor: int
    items: list[GroupChange]


class Activity(BaseModel):
    seq: int
    actor: UUID
    kind: str
    details: dict


class ActivityPage(BaseModel):
    items: list[Activity]
    nextCursor: int | None


class Operation(BaseModel):
    status: Literal["pending", "done", "failed"]
    result: GroupSnapshot | OriginalMessage | dict | None
