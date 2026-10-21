"""Print requests: the Services page (public) and S3 / M5 (staff, print_requests.manage).
Also the Contact page and the staff list of contact messages."""

import json
import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.api.deps import DB, AnyStaff, Context, OptionalCustomer, require
from app.core.config import get_settings
from app.core.permissions import Capability
from app.core.phone import format_phone
from app.core.ratelimit import rate_limit
from app.core.storage import FileStorage, get_storage
from app.models import PrintRequest, Staff
from app.services import contact, print_requests
from app.services.errors import NotFound, ServiceError
from app.services.notifications import Email, Notifier, get_notifier, send_later
from app.services.staff_orders import staff_names

router = APIRouter(tags=["print requests"])
Manager = Annotated[Staff, Depends(require(Capability.PRINT_REQUESTS_MANAGE))]
Storage = Annotated[FileStorage, Depends(get_storage)]
NotifierDep = Annotated[Notifier, Depends(get_notifier)]


class FileOut(BaseModel):
    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int


class HistoryOut(BaseModel):
    status: str
    event: str | None
    note: str | None
    who: str
    at: datetime


class RequestOut(BaseModel):
    id: uuid.UUID
    number: str
    type: str
    summary: str
    details: dict
    status: str
    customer: str
    phone: str | None
    email: str | None
    has_account: bool
    needed_by: date | None
    quote_rwf: int | None
    ready_on: date | None
    assigned_to: str | None
    assigned_staff_id: uuid.UUID | None
    paid_with: str | None
    created_at: datetime
    files: list[FileOut] = []
    history: list[HistoryOut] = []


class RequestBoard(BaseModel):
    items: list[RequestOut]
    counts: dict[str, int]
    staff: list[dict]  # people a request can be assigned to


class PublicRequestOut(BaseModel):
    number: str
    type: str
    summary: str
    name: str
    phone: str


def _out(db: DB, request: PrintRequest, *, full: bool = False, names: dict | None = None) -> RequestOut:
    names = names if names is not None else staff_names(db, {request.assigned_staff_id})
    out = RequestOut(
        id=request.id, number=request.number, type=request.type, summary=print_requests.summary(request),
        details=request.details or {}, status=request.status, customer=request.guest_name or "—",
        phone=print_requests.phone_label(request), email=request.guest_email, has_account=request.customer_id is not None,
        needed_by=request.needed_by, quote_rwf=request.quote_rwf, ready_on=request.ready_on,
        assigned_to=names.get(request.assigned_staff_id), assigned_staff_id=request.assigned_staff_id,
        paid_with=request.paid_with, created_at=request.created_at,
    )
    if full:
        history = print_requests.history(db, request)
        who = staff_names(db, {h.staff_id for h in history})
        out.files = [FileOut(id=f.id, filename=f.filename, content_type=f.content_type, size_bytes=f.size_bytes)
                     for f in print_requests.files(db, request)]
        out.history = [HistoryOut(status=h.to_status, event=h.event, note=h.note,
                                  who=who.get(h.staff_id, "Customer") if h.staff_id else "Customer", at=h.at)
                       for h in history]
    return out


async def _uploads(files: list[UploadFile] | None) -> list[print_requests.Upload]:
    out = []
    limit = get_settings().max_request_file_bytes
    for f in files or []:
        if not f.filename:
            continue
        # One byte past the limit is enough to refuse an oversized file.
        out.append(print_requests.Upload(filename=f.filename, data=await f.read(limit + 1)))
    return out


def _parse_details(raw: str) -> dict:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        raise ServiceError("The request details couldn't be read.", code="invalid_details") from None
    if not isinstance(value, dict):
        raise ServiceError("The request details couldn't be read.", code="invalid_details")
    return value


# Public: the Services page


@router.post("/print-requests", response_model=PublicRequestOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit("print_request", 5, 10 * 60))])
async def create_request(
    db: DB,
    storage: Storage,
    customer: OptionalCustomer,
    type: Annotated[Literal["invitations", "binding"], Form()],
    name: Annotated[str, Form(max_length=120)],
    phone: Annotated[str, Form(max_length=32)],
    details: Annotated[str, Form(max_length=5000, description='JSON, e.g. {"event": "Wedding", "quantity": 200}')],
    email: Annotated[str | None, Form(max_length=254)] = None,
    needed_by: Annotated[date | None, Form()] = None,
    files: Annotated[list[UploadFile] | None, File(description="PDF, JPG or PNG, up to 3 files of 20 MB")] = None,
) -> PublicRequestOut:
    request = print_requests.create(
        db, kind=type, name=name, phone=phone, email=email or (customer.email if customer else None),
        needed_by=needed_by, details=_parse_details(details), uploads=await _uploads(files), storage=storage,
        customer_id=customer.id if customer else None,
    )
    db.commit()
    return PublicRequestOut(number=request.number, type=request.type, summary=print_requests.summary(request),
                            name=request.guest_name or "", phone=format_phone(request.guest_phone))


# Staff: S3 and M5


@router.get("/staff/print-requests", response_model=RequestBoard)
def board(db: DB, staff: Manager, status_filter: Annotated[str | None, Query(alias="status")] = None,
          q: Annotated[str | None, Query(max_length=80)] = None,
          collected_limit: Annotated[int, Query(ge=1, le=500)] = 20) -> RequestBoard:
    rows = print_requests.list_requests(db, status=status_filter, q=q, collected_limit=collected_limit)
    names = staff_names(db, {r.assigned_staff_id for r in rows})
    team = [{"id": s.id, "name": s.name, "role": s.role}
            for s in db.query(Staff).filter(Staff.is_active.is_(True)).order_by(Staff.name)]
    return RequestBoard(items=[_out(db, r, names=names) for r in rows], counts=print_requests.counts(db), staff=team)


@router.get("/staff/print-requests/{request_id}", response_model=RequestOut)
def get_request(request_id: uuid.UUID, db: DB, staff: Manager) -> RequestOut:
    return _out(db, print_requests.get(db, request_id), full=True)


@router.post("/staff/print-requests", response_model=RequestOut, status_code=status.HTTP_201_CREATED)
async def staff_create(
    db: DB,
    staff: Manager,
    context: Context,
    storage: Storage,
    type: Annotated[Literal["invitations", "binding"], Form()],
    name: Annotated[str, Form(max_length=120)],
    phone: Annotated[str, Form(max_length=32)],
    details: Annotated[str, Form(max_length=5000)],
    needed_by: Annotated[date | None, Form()] = None,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> RequestOut:
    """A walk-in or phone request taken at the counter (S3 "Add request")."""
    request = print_requests.create(
        db, kind=type, name=name, phone=phone, email=None, needed_by=needed_by, details=_parse_details(details),
        uploads=await _uploads(files), storage=storage, actor=staff, context=context,
    )
    db.commit()
    return _out(db, request, full=True)


class QuoteIn(BaseModel):
    quote_rwf: int = Field(gt=0, le=100_000_000)
    ready_on: date


class AdvanceIn(BaseModel):
    paid_with: Literal["cash", "mobile_money"] | None = None


class AssignIn(BaseModel):
    assigned_staff_id: uuid.UUID | None


class WhatsAppIn(BaseModel):
    template: Literal["quote", "ready", "general"]


@router.post("/staff/print-requests/{request_id}/quote", response_model=RequestOut)
def quote(request_id: uuid.UUID, body: QuoteIn, db: DB, staff: Manager, context: Context) -> RequestOut:
    request = print_requests.quote(db, staff, print_requests.get(db, request_id, lock=True), quote_rwf=body.quote_rwf,
                                   ready_on=body.ready_on, context=context)
    db.commit()
    return _out(db, request, full=True)


@router.post("/staff/print-requests/{request_id}/status", response_model=RequestOut)
def advance(request_id: uuid.UUID, body: AdvanceIn, db: DB, staff: Manager, context: Context) -> RequestOut:
    request = print_requests.advance(db, staff, print_requests.get(db, request_id, lock=True), paid_with=body.paid_with,
                                     context=context)
    db.commit()
    return _out(db, request, full=True)


@router.patch("/staff/print-requests/{request_id}", response_model=RequestOut)
def assign(request_id: uuid.UUID, body: AssignIn, db: DB, staff: Manager, context: Context) -> RequestOut:
    request = print_requests.assign(db, staff, print_requests.get(db, request_id, lock=True), body.assigned_staff_id, context)
    db.commit()
    return _out(db, request, full=True)


@router.post("/staff/print-requests/{request_id}/whatsapp-link")
def whatsapp(request_id: uuid.UUID, body: WhatsAppIn, db: DB, staff: Manager, context: Context) -> dict:
    url, text = print_requests.whatsapp(db, staff, print_requests.get(db, request_id), body.template, context)
    db.commit()
    return {"url": url, "text": text}


@router.get("/staff/print-requests/{request_id}/files/{file_id}")
def download(request_id: uuid.UUID, file_id: uuid.UUID, db: DB, staff: Manager, storage: Storage) -> Response:
    """Staff only. Sent as a download so a file can't run in the browser as a page."""
    request = print_requests.get(db, request_id)
    match = next((f for f in print_requests.files(db, request) if f.id == file_id), None)
    if match is None:
        raise NotFound("That file doesn't exist.", code="file_not_found")
    return Response(
        content=storage.read_private(match.url),
        media_type=match.content_type,
        headers={"Content-Disposition": f'attachment; filename="{match.filename}"', "X-Content-Type-Options": "nosniff",
                 "Cache-Control": "private, no-store"},
    )


# Contact page


class ContactIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str = Field(max_length=32)
    message: str = Field(min_length=1, max_length=4000)


class ContactOut(BaseModel):
    id: uuid.UUID
    name: str
    phone: str
    message: str
    created_at: datetime


@router.post("/contact", status_code=status.HTTP_201_CREATED, dependencies=[Depends(rate_limit("contact", 5, 10 * 60))])
def send_contact(body: ContactIn, db: DB, background: BackgroundTasks, notifier: NotifierDep) -> dict:
    row = contact.create(db, name=body.name, phone=body.phone, message=body.message)
    db.commit()
    to = contact.shop_email(db)
    if to:
        send_later(background, notifier, Email(to, f"New message from {row.name}",
                                               f"{row.name} ({format_phone(row.phone)}) wrote:\n\n{row.message}"))
    return {"message": "Thanks! We will get back to you by phone."}


@router.get("/staff/contact-messages", response_model=list[ContactOut])
def open_messages(db: DB, staff: AnyStaff) -> list[ContactOut]:
    return [ContactOut(id=m.id, name=m.name, phone=format_phone(m.phone), message=m.message, created_at=m.created_at)
            for m in contact.open_messages(db)]


@router.post("/staff/contact-messages/{message_id}/handled", status_code=status.HTTP_204_NO_CONTENT)
def mark_handled(message_id: uuid.UUID, db: DB, staff: AnyStaff, context: Context) -> Response:
    contact.mark_handled(db, staff, message_id, context)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
