"""Print requests: invitations and book binding (HANDOFF.md, "Order and print-request lifecycles").

New -> Quoted (price and ready date sent on WhatsApp) -> In progress (customer accepted) -> Ready -> Collected.
Paid at pickup: collecting records Cash or Mobile Money. Staff changes write history and the activity log.
"""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.phone import format_phone, normalize_phone
from app.core.security import utcnow
from app.core.storage import FileStorage
from app.models import PrintRequest, PrintRequestFile, PrintRequestHistory, Staff
from app.services import audit, shop_settings
from app.services.context import RequestContext
from app.services.errors import NotFound, ServiceError
from app.services.notifications import fill_template, whatsapp_link

NEXT_STATUS = {"quoted": "in_progress", "in_progress": "ready", "ready": "collected"}
OPEN = ("new", "quoted", "in_progress", "ready")
EVENTS = ("Wedding", "Graduation", "Baptism", "Ceremony", "Other")
BINDINGS = ("Spiral", "Softcover", "Hardcover")
TEMPLATES = {"quote": "print_quote", "ready": "print_ready", "general": "general"}

# Files are checked by their first bytes, not by name or the browser's content type.
_SIGNATURES = (
    (b"%PDF-", "application/pdf", "pdf"),
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
)


@dataclass(frozen=True)
class Upload:
    filename: str
    data: bytes


def _label(request: PrintRequest) -> str:
    return request.number


def summary(request: PrintRequest) -> str:
    """Short text for cards and messages, for example "200 wedding cards" or "Hardcover · 4 copies"."""
    d = request.details or {}
    if request.type == "invitations":
        event = (d.get("event") or "").lower()
        return f"{d.get('quantity', '?')} {event + ' ' if event and event != 'other' else ''}cards"
    parts = [d.get("binding") or "Binding", f"{d.get('copies', '?')} {'copy' if d.get('copies') == 1 else 'copies'}"]
    if d.get("pages"):
        parts.append(f"~{d['pages']} pages")
    return " · ".join(parts)


def check_file(upload: Upload) -> tuple[str, str]:
    settings = get_settings()
    limit_mb = settings.max_request_file_bytes // (1024 * 1024)
    if len(upload.data) > settings.max_request_file_bytes:
        raise ServiceError(f"{upload.filename}: files must be {limit_mb} MB or smaller.", code="file_too_large")
    for signature, content_type, extension in _SIGNATURES:
        if upload.data.startswith(signature):
            return content_type, extension
    raise ServiceError(f"{upload.filename}: only PDF, JPG or PNG files can be sent.", code="invalid_file")


def _int(value: object) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _details(kind: str, raw: dict) -> dict:
    notes = str(raw.get("notes") or "").strip()[:2000]
    if kind == "invitations":
        if raw.get("event") not in EVENTS:
            raise ServiceError("Choose the event.", code="event_required")
        quantity = _int(raw.get("quantity"))
        if not 1 <= quantity <= 10_000:
            raise ServiceError("Enter how many cards you need.", code="quantity_required")
        return {"event": raw["event"], "quantity": quantity, "notes": notes}
    if raw.get("binding") not in BINDINGS:
        raise ServiceError("Choose the binding type.", code="binding_required")
    copies = _int(raw.get("copies"))
    if not 1 <= copies <= 500:
        raise ServiceError("Enter the number of copies.", code="copies_required")
    pages = _int(raw.get("pages")) or None
    if pages is not None and not 1 <= pages <= 5000:
        raise ServiceError("Enter the number of pages per copy.", code="invalid_pages")
    return {"binding": raw["binding"], "copies": copies, "pages": pages, "notes": notes}


def create(
    db: Session,
    *,
    kind: str,
    name: str,
    phone: str,
    email: str | None,
    needed_by: date | None,
    details: dict,
    uploads: list[Upload],
    storage: FileStorage,
    customer_id: uuid.UUID | None = None,
    actor: Staff | None = None,
    context: RequestContext | None = None,
) -> PrintRequest:
    """From the Services page (guest or customer) or from S3 for walk-in and phone requests (actor set)."""
    if kind not in ("invitations", "binding"):
        raise ServiceError("Choose invitations or book binding.", code="invalid_type")
    if len(name.strip()) < 2:
        raise ServiceError("Add your name so we can reach you.", code="name_required")
    try:
        phone = normalize_phone(phone)
    except ValueError as error:
        raise ServiceError(str(error), code="invalid_phone") from None
    if needed_by is not None and needed_by < shop_settings.today_in_kigali():
        raise ServiceError("The date needed can't be in the past.", code="invalid_date")
    if len(uploads) > get_settings().max_request_files:
        raise ServiceError(f"Send up to {get_settings().max_request_files} files.", code="too_many_files")
    checked = [(u, *check_file(u)) for u in uploads]

    request = PrintRequest(
        type=kind,
        guest_name=name.strip(),
        guest_phone=phone,
        guest_email=(email or "").strip().lower() or None,
        needed_by=needed_by,
        details=_details(kind, details),
        customer_id=customer_id,
        created_by_staff_id=actor.id if actor else None,
    )
    db.add(request)
    db.flush()
    for upload, content_type, extension in checked:
        key = storage.save_private(f"print-requests/{uuid.uuid4().hex}.{extension}", upload.data)
        safe_name = "".join(ch for ch in upload.filename if ch.isalnum() or ch in "._- ")[:200] or f"file.{extension}"
        db.add(PrintRequestFile(request_id=request.id, url=key, filename=safe_name, content_type=content_type,
                                size_bytes=len(upload.data)))
    db.add(PrintRequestHistory(request_id=request.id, to_status="new", staff_id=actor.id if actor else None))
    db.flush()
    if actor is not None:
        audit.record(db, actor, "print_request.created", entity_type="print_request", entity_id=request.id,
                     entity_label=_label(request), after={"type": kind, "summary": summary(request)}, context=context)
    return request


def get(db: Session, request_id: uuid.UUID, *, lock: bool = False) -> PrintRequest:
    query = select(PrintRequest).where(PrintRequest.id == request_id)
    if lock:
        query = query.with_for_update()
    request = db.scalar(query)
    if request is None:
        raise NotFound("That request doesn't exist.", code="request_not_found")
    return request


def list_requests(db: Session, *, status: str | None, q: str | None) -> list[PrintRequest]:
    query = select(PrintRequest)
    if status == "open":
        query = query.where(PrintRequest.status.in_(OPEN))
    elif status:
        query = query.where(PrintRequest.status == status)
    else:
        query = query.where(PrintRequest.status != "cancelled")
    if q and q.strip():
        term = q.strip()
        conditions = [PrintRequest.number.ilike(f"%{term}%"), PrintRequest.guest_name.ilike(f"%{term}%")]
        try:
            conditions.append(PrintRequest.guest_phone == normalize_phone(term))
        except ValueError:
            pass
        query = query.where(or_(*conditions))
    # Collected requests drop off the board after a while; the newest 200 are enough for S3.
    return list(db.scalars(query.order_by(PrintRequest.needed_by.nulls_last(), PrintRequest.created_at).limit(200)))


def counts(db: Session) -> dict[str, int]:
    return dict(db.execute(select(PrintRequest.status, func.count()).group_by(PrintRequest.status)).all())


def files(db: Session, request: PrintRequest) -> list[PrintRequestFile]:
    return list(db.scalars(select(PrintRequestFile).where(PrintRequestFile.request_id == request.id).order_by(PrintRequestFile.created_at)))


def history(db: Session, request: PrintRequest) -> list[PrintRequestHistory]:
    return list(db.scalars(select(PrintRequestHistory).where(PrintRequestHistory.request_id == request.id)
                           .order_by(PrintRequestHistory.at, PrintRequestHistory.created_at)))


def _history(db: Session, request: PrintRequest, actor: Staff | None, to_status: str, *, from_status: str | None = None,
             event: str | None = None, note: str | None = None) -> None:
    db.add(PrintRequestHistory(request_id=request.id, from_status=from_status, to_status=to_status,
                               staff_id=actor.id if actor else None, event=event, note=note))


def quote(db: Session, actor: Staff, request: PrintRequest, *, quote_rwf: int, ready_on: date, context: RequestContext) -> PrintRequest:
    """A price and a ready date. Can be changed until the customer accepts."""
    if request.status not in ("new", "quoted"):
        raise ServiceError("The quote can't change after the customer accepted.", code="already_accepted")
    if quote_rwf <= 0:
        raise ServiceError("Enter a price.", code="price_required")
    if ready_on < shop_settings.today_in_kigali():
        raise ServiceError("The ready date can't be in the past.", code="invalid_date")
    before = {"status": request.status, "quote_rwf": request.quote_rwf, "ready_on": request.ready_on}
    _history(db, request, actor, "quoted", from_status=request.status, note=f"{quote_rwf:,} RWF · ready {ready_on.isoformat()}")
    request.status = "quoted"
    request.quote_rwf = quote_rwf
    request.ready_on = ready_on
    request.quoted_at = utcnow()
    db.flush()
    audit.record(db, actor, "print_request.quoted", entity_type="print_request", entity_id=request.id,
                 entity_label=_label(request), before=before,
                 after={"status": "quoted", "quote_rwf": quote_rwf, "ready_on": ready_on}, context=context)
    return request


def accept_by_customer(db: Session, request: PrintRequest) -> PrintRequest:
    if request.status != "quoted":
        raise ServiceError("There is no quote waiting for you to accept.", code="nothing_to_accept")
    _history(db, request, None, "in_progress", from_status="quoted", note="Accepted by customer")
    request.status = "in_progress"
    request.accepted_at = utcnow()
    db.flush()
    return request


def advance(db: Session, actor: Staff, request: PrintRequest, *, paid_with: str | None, context: RequestContext) -> PrintRequest:
    """quoted -> in_progress ("Customer accepted"), in_progress -> ready, ready -> collected (paid at pickup)."""
    if request.status == "new":
        raise ServiceError("Send a quote first.", code="quote_required")
    nxt = NEXT_STATUS.get(request.status)
    if nxt is None:
        raise ServiceError("This request is finished.", code="final_status")
    if nxt == "collected":
        if paid_with not in ("cash", "mobile_money"):
            raise ServiceError("Choose how the customer paid: Cash or Mobile Money.", code="paid_with_required")
        request.paid_with = paid_with
        request.paid_at = utcnow()
    if nxt == "in_progress":
        request.accepted_at = utcnow()

    note = "Customer accepted" if nxt == "in_progress" else None
    _history(db, request, actor, nxt, from_status=request.status, note=note)
    before = {"status": request.status}
    request.status = nxt
    db.flush()
    audit.record(db, actor, "print_request.status_changed", entity_type="print_request", entity_id=request.id,
                 entity_label=_label(request), before=before, after={"status": nxt, "paid_with": request.paid_with},
                 context=context)
    return request


def assign(db: Session, actor: Staff, request: PrintRequest, staff_id: uuid.UUID | None, context: RequestContext) -> PrintRequest:
    if staff_id is not None:
        target = db.get(Staff, staff_id)
        if target is None or not target.is_active:
            raise ServiceError("Choose someone on the team.", code="invalid_assignee")
    if request.assigned_staff_id == staff_id:
        return request
    before = {"assigned_staff_id": request.assigned_staff_id}
    request.assigned_staff_id = staff_id
    name = db.get(Staff, staff_id).name if staff_id else "nobody"
    _history(db, request, actor, request.status, from_status=request.status, event="assigned", note=name)
    db.flush()
    audit.record(db, actor, "print_request.assigned", entity_type="print_request", entity_id=request.id,
                 entity_label=_label(request), before=before, after={"assigned_staff_id": staff_id, "name": name},
                 context=context)
    return request


def whatsapp(db: Session, actor: Staff, request: PrintRequest, template: str, context: RequestContext) -> tuple[str, str]:
    if template not in TEMPLATES:
        raise ServiceError("Unknown message.", code="unknown_template")
    if template == "quote" and request.quote_rwf is None:
        raise ServiceError("Enter a price first.", code="price_required")
    templates = shop_settings.get(db, "message_templates", {})
    text = fill_template(
        templates.get(TEMPLATES[template]) or "Pahyems request {order}",
        name=(request.guest_name or "").split(" ")[0],
        order=request.number,
        details=summary(request),
        total=f"{request.quote_rwf:,} RWF" if request.quote_rwf else "",
        ready_on=request.ready_on.strftime("%d %B") if request.ready_on else "",
    )
    _history(db, request, actor, request.status, from_status=request.status, event="whatsapp_opened", note=template)
    db.flush()
    audit.record(db, actor, "print_request.whatsapp_opened", entity_type="print_request", entity_id=request.id,
                 entity_label=_label(request), after={"template": template}, context=context)
    return whatsapp_link(request.guest_phone, text), text


def phone_label(request: PrintRequest) -> str | None:
    return format_phone(request.guest_phone) if request.guest_phone else None
