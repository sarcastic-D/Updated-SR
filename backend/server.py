from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import logging
import uuid
import random
import bcrypt
import jwt
from calendar import monthrange
from datetime import datetime, timezone, timedelta, date as date_cls
from typing import List, Optional, Literal, Dict, Set

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict


# ---------------------------------------------------------------------------
# Logging / Mongo
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]


# ---------------------------------------------------------------------------
# Domain constants
# ---------------------------------------------------------------------------
WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
WEEKOFF_PAIRS = [
    ("Monday", "Tuesday"),
    ("Tuesday", "Wednesday"),
    ("Wednesday", "Thursday"),
    ("Thursday", "Friday"),
    ("Friday", "Saturday"),
    ("Saturday", "Sunday"),
    ("Sunday", "Monday"),
]

SHIFTS = {
    "M": {"name": "Morning", "display": "7AM - 3PM"},
    "A": {"name": "Noon",    "display": "3PM - 11PM"},
    "N": {"name": "Night",   "display": "11PM - 7AM"},
}

# ---------------------------------------------------------------------------
# L2 team: 5 paired (week-off, shift) patterns applied round-robin by emp_id.
#
# WHY these specific pairings (M, A, M, A, N)?
# Each entry pairs a week-off with a shift so that on every working day the
# coverage across available employees is as balanced as possible:
#
#  Day       Workers (by pattern)              Coverage
#  --------- --------------------------------  ----------
#  Monday    L2-1(M) L2-2(A) L2-3(M) L2-4(A)          2M 2A 0N
#  Tuesday   L2-1(M) L2-2(A) L2-3(M) L2-4(A)          2M 2A 0N
#  Wednesday L2-1(M) L2-2(A) L2-3(M) L2-4(A) L2-5(N)  2M 2A 1N (perfect)
#  Thursday  L2-1(M) L2-2(A) L2-3(M)         L2-5(N)  2M 1A 1N
#  Friday    L2-1(M) L2-2(A)                 L2-5(N)  1M 1A 1N
#  Saturday              L2-4(A)             L2-5(N)  0M 1A 1N
#  Sunday            L2-3(M) L2-4(A)         L2-5(N)  1M 1A 1N
#
# Using naive [M,M,A,A,N] instead gives Friday = 2M+0A+1N (zero Noon!).
# The M,A,M,A,N interleaving distributes all three shift types across all days.
# ---------------------------------------------------------------------------
# L2 team: 5 employees total (2M, 2A, 1N).
# To ensure M and A coverage never drops to 0, we must pair them such that
# their weekoffs do not overlap.
# M: Sat/Sun and Thu/Fri
# A: Sat/Sun and Mon/Tue
# N: Fri/Sat (drops to 0 on weekoff, accepted by user)
# ---------------------------------------------------------------------------
L2_PATTERNS = [
    (["Saturday", "Sunday"],  "M"),
    (["Saturday", "Sunday"],  "A"),
    (["Friday",   "Saturday"],"N"),
    (["Thursday", "Friday"],  "M"),
    (["Monday",   "Tuesday"], "A"),
]

# ---------------------------------------------------------------------------
# L3 team: fixed Sat/Sun off, no Night shift, 3 Morning / 2 Noon per day
# Custom shift timings: Morning 9AM-6PM, Noon 12PM-9PM
# ---------------------------------------------------------------------------
L3_WEEKOFF = ["Saturday", "Sunday"]
L3_SHIFT_CYCLE = ["M", "M", "M", "A", "A"]  # 3 Morning / 2 Noon

ROLES = {"admin", "manager", "user"}
SOC_LEVELS = {"", "L1", "L2", "L3"}

# 23 employees from reference (SecOps flag preserved, plus default SOC level)
SEED_EMPLOYEES = [
    ("SR", "sr@company.com", False, "L2"),
    ("SS", "ss@company.com", False, "L1"),
    ("RB", "rb@company.com", False, "L1"),
    ("ST", "st@company.com", True,  "L3"),
    ("HK", "hk@company.com", True,  "L3"),
    ("AS", "al@company.com", False, "L2"),
    ("DK", "di@company.com", True,  "L3"),
    ("AK", "ak@company.com", True,  "L2"),
    ("Ri", "ri@company.com", False, "L1"),
    ("Bo", "bo@company.com", False, "L1"),
    ("AT", "at@company.com", False, "L2"),
    ("SD", "sd@company.com", False, "L1"),
    ("GM", "gm@company.com", True,  "L2"),
    ("AD", "ad@company.com", True,  "L3"),
    ("GD", "gd@company.com", True,  "L2"),
    ("SG", "sg@company.com", False, "L1"),
    ("RS", "rs@company.com", False, "L2"),
    ("Br", "br@company.com", False, "L1"),
    ("SC", "sc@company.com", True,  "L2"),
    ("KR", "kr@company.com", True,  "L3"),
    ("SZ", "sz@company.com", False, "L1"),
    ("SP", "sp@company.com", False, "L1"),
    ("Su", "su@company.com", True,  "L2"),
]


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60  # shortened from 8h to 1h (refresh token handles session length)
REFRESH_TOKEN_DAYS = 7

# --- Security guardrails (evaluated once at module load) ---
_WEAK_JWT_SECRETS = {
    "", "changeme", "secret", "jwt-secret", "your-secret-key",
    "chalchalsr-jwt-secret-local-2026",  # ← known default from template
}
_JWT_SECRET_VALUE = os.environ.get("JWT_SECRET", "")
if len(_JWT_SECRET_VALUE) < 32 or _JWT_SECRET_VALUE.strip().lower() in _WEAK_JWT_SECRETS:
    raise RuntimeError(
        "JWT_SECRET must be at least 32 characters and not a known default. "
        "Generate one with: python -c \"import secrets;print(secrets.token_urlsafe(48))\""
    )

# Cookies must be Secure over HTTPS. Set COOKIE_SECURE=true in production.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
# SameSite=lax works with post-login redirects; strict blocks cross-site nav.
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "lax").lower()

# Pre-computed bcrypt hash of a random string — used to make login timing
# constant when the email doesn't exist (defeats user-enumeration timing attacks).
_DUMMY_PASSWORD_HASH = bcrypt.hashpw(b"__nonexistent_user_dummy__", bcrypt.gensalt()).decode()

# Brute-force lockout policy
MAX_LOGIN_ATTEMPTS = int(os.environ.get("MAX_LOGIN_ATTEMPTS", "5"))
LOGIN_LOCKOUT_MINUTES = int(os.environ.get("LOGIN_LOCKOUT_MINUTES", "15"))


def get_jwt_secret() -> str:
    return _JWT_SECRET_VALUE


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id, "email": email, "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        "jti": uuid.uuid4().hex,
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(days=REFRESH_TOKEN_DAYS),
        "jti": uuid.uuid4().hex,
        "type": "refresh",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def _set_auth_cookies(response: Response, access: str, refresh: str) -> None:
    response.set_cookie(
        "access_token", access, httponly=True, secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE, max_age=ACCESS_TOKEN_MINUTES * 60, path="/",
    )
    response.set_cookie(
        "refresh_token", refresh, httponly=True, secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE, max_age=REFRESH_TOKEN_DAYS * 86400, path="/api/auth",
    )


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user.pop("_id", None)
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_roles(*allowed: str):
    async def _checker(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user.get("role") not in allowed:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return _checker


# ---------------------------------------------------------------------------
# Security helpers: password policy, brute-force lockout, audit log
# ---------------------------------------------------------------------------
import re as _re  # local alias so we don't touch top-of-file imports

_PASSWORD_MIN_LEN = 8
_PASSWORD_RE = _re.compile(r"^(?=.*[A-Za-z])(?=.*\d).{%d,128}$" % _PASSWORD_MIN_LEN)


def validate_password_strength(pw: str) -> None:
    """Raise HTTP 400 if password does not meet the policy."""
    if not isinstance(pw, str) or len(pw) < _PASSWORD_MIN_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {_PASSWORD_MIN_LEN} characters long",
        )
    if not _PASSWORD_RE.match(pw):
        raise HTTPException(
            status_code=400,
            detail="Password must contain at least one letter and one digit",
        )


def _client_ip(request: Request) -> str:
    # Trust the proxy chain but only take the first hop
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def is_login_locked(identifier: str) -> Optional[datetime]:
    doc = await db.login_attempts.find_one({"identifier": identifier})
    if not doc:
        return None
    if doc.get("count", 0) >= MAX_LOGIN_ATTEMPTS:
        locked_until_str = doc.get("locked_until")
        if locked_until_str:
            try:
                locked_until = datetime.fromisoformat(locked_until_str)
                if datetime.now(timezone.utc) < locked_until:
                    return locked_until
                # Lockout expired — clear the record
                await db.login_attempts.delete_one({"identifier": identifier})
            except ValueError:
                pass
    return None


async def record_login_failure(identifier: str) -> None:
    now = datetime.now(timezone.utc)
    doc = await db.login_attempts.find_one({"identifier": identifier})
    count = (doc.get("count", 0) if doc else 0) + 1
    update: dict = {
        "identifier": identifier,
        "count": count,
        "last_failure_at": now.isoformat(),
    }
    if count >= MAX_LOGIN_ATTEMPTS:
        update["locked_until"] = (now + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)).isoformat()
    await db.login_attempts.update_one(
        {"identifier": identifier}, {"$set": update}, upsert=True,
    )


async def clear_login_failures(identifier: str) -> None:
    await db.login_attempts.delete_one({"identifier": identifier})


async def audit(event: str, request: Request, *, actor: Optional[dict] = None,
                target: Optional[str] = None, extra: Optional[dict] = None) -> None:
    """Append-only audit log for security-relevant events."""
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": event,
            "actor_id": (actor or {}).get("id"),
            "actor_email": (actor or {}).get("email"),
            "target": target,
            "ip": _client_ip(request),
            "user_agent": request.headers.get("user-agent", "")[:250],
            "extra": extra or {},
        })
    except Exception as ex:  # never let audit failure break the request
        logger.warning(f"audit write failed for {event}: {ex}")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
ShiftCode = Literal["M", "A", "N", ""]
SOCLevel = Literal["", "L1", "L2", "L3"]
RoleLiteral = Literal["admin", "manager", "user"]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    role: str
    linked_emp_id: Optional[str] = ""


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=4, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    role: RoleLiteral
    linked_emp_id: Optional[str] = ""


class UserWithEmployeeCreate(BaseModel):
    """Creates a user account AND an employee record in one atomic step."""
    email: EmailStr
    password: str = Field(min_length=4, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    role: RoleLiteral
    is_secops: bool = False
    soc_level: SOCLevel = ""


class UserUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    role: Optional[RoleLiteral] = None
    password: Optional[str] = Field(default=None, min_length=4, max_length=100)
    linked_emp_id: Optional[str] = None


class EmployeeBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    emp_id: str = Field(min_length=1, max_length=50)
    email: EmailStr
    is_secops: bool = False
    soc_level: SOCLevel = ""


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    emp_id: Optional[str] = Field(default=None, min_length=1, max_length=50)
    email: Optional[EmailStr] = None
    is_secops: Optional[bool] = None
    soc_level: Optional[SOCLevel] = None
    assigned_shift: Optional[ShiftCode] = None
    weekoff_days: Optional[List[str]] = None


class Employee(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    emp_id: str
    name: str
    email: str
    is_secops: bool = False
    soc_level: SOCLevel = ""
    assigned_shift: ShiftCode = ""
    weekoff_days: List[str] = Field(default_factory=lambda: ["Saturday", "Sunday"])
    created_at: str


class RosterEntry(BaseModel):
    employee_id: str
    date: str
    code: Literal["WD", "WO", "L", "Adj", ""]
    sub_type: Optional[Literal["Morning", "Evening", "Night", ""]] = ""


class RosterBulk(BaseModel):
    entries: List[RosterEntry]


class LeaveRequestCreate(BaseModel):
    emp_id: str
    start_date: str  # YYYY-MM-DD
    end_date: str
    reason: str = Field(min_length=1, max_length=500)


class LeaveApproveRequest(BaseModel):
    replacement_emp_id: str


# ---------------------------------------------------------------------------
# Scheduling engine
# ---------------------------------------------------------------------------
def assign_l2_shifts(employees: List[dict]) -> List[dict]:
    """Assign L2-specific paired (week-off, shift) patterns round-robin by emp_id.

    The pattern M,A,M,A,N is chosen so that on each day of the week the
    combination of who is OFF and who is ON produces the most balanced
    coverage possible:
      - Wednesday (all present): 2M 2A 1N  (perfect target)
      - Monday / Tuesday:        2M 2A 0N  (L2-5/Night is off)
      - Thursday:                2M 1A 1N
      - Friday:                  1M 1A 1N  (all shift types present)
      - Sunday:                  1M 1A 1N
    The naive [M,M,A,A,N] produces Friday=2M+0A+1N (zero Noon coverage).
    """
    sorted_emps = sorted(employees, key=lambda e: e.get("emp_id", ""))
    for idx, emp in enumerate(sorted_emps):
        weekoff, shift = L2_PATTERNS[idx % len(L2_PATTERNS)]
        emp["weekoff_days"] = list(weekoff)
        emp["assigned_shift"] = shift
    return employees


def assign_l3_shifts(employees: List[dict]) -> List[dict]:
    """Assign L3-specific fixed Sat/Sun week-offs and 3M/2A shift cycle. No Night shift."""
    sorted_emps = sorted(employees, key=lambda e: e.get("emp_id", ""))
    for idx, emp in enumerate(sorted_emps):
        emp["weekoff_days"] = list(L3_WEEKOFF)
        emp["assigned_shift"] = L3_SHIFT_CYCLE[idx % len(L3_SHIFT_CYCLE)]
    return employees


def assign_shifts_and_weekoffs(employees: List[dict]) -> List[dict]:
    """Assign shifts and week-offs per team level.
    - L2: fixed week-off patterns, 2M/2A/1N cycle
    - L3: Sat/Sun off, 3M/2A cycle, no Night
    - L1 / others: round-robin M/A/N with random balanced week-offs
    Mutates and returns the same list.
    """
    l2_emps = [e for e in employees if e.get("soc_level") == "L2"]
    l3_emps = [e for e in employees if e.get("soc_level") == "L3"]
    l1_emps = [e for e in employees if e.get("soc_level") not in ("L2", "L3")]

    # L2 — fixed patterns
    assign_l2_shifts(l2_emps)

    # L3 — fixed Sat/Sun, 3M/2A
    assign_l3_shifts(l3_emps)

    # L1 / others — existing round-robin logic
    TARGETS = [("M", 8), ("A", 8), ("N", 7)]
    secops = [e for e in l1_emps if e.get("is_secops")]
    non_sec = [e for e in l1_emps if not e.get("is_secops")]
    random.shuffle(secops)
    random.shuffle(non_sec)

    ordered: List[dict] = []
    i_s = i_n = 0
    while i_s < len(secops) or i_n < len(non_sec):
        if i_s < len(secops):
            ordered.append(secops[i_s]); i_s += 1
        if i_n < len(non_sec):
            ordered.append(non_sec[i_n]); i_n += 1

    cycle_shifts = ["M", "A", "N"]
    for idx in range(len(ordered)):
        ordered[idx]["assigned_shift"] = cycle_shifts[idx % 3]

    for code, _ in TARGETS:
        shift_emps = [e for e in l1_emps if e.get("assigned_shift") == code]
        random.shuffle(shift_emps)
        n = len(shift_emps)
        if n == 0:
            continue
        pairs = list(WEEKOFF_PAIRS)
        floor_times = n // len(pairs)
        extras = n % len(pairs)
        sequence = list(pairs) * floor_times
        if extras > 0:
            sequence.extend(random.sample(pairs, extras))
        random.shuffle(sequence)
        for emp, pair in zip(shift_emps, sequence):
            emp["weekoff_days"] = list(pair)

    return employees


def build_monthly_schedules(
    employees: List[dict],
    year: int,
    month: int,
    approved_leaves: Dict[str, Set[str]],
    replacements: List[dict],
) -> dict:
    _, num_days = monthrange(year, month)
    dates_iso = [date_cls(year, month, d).isoformat() for d in range(1, num_days + 1)]

    schedules: Dict[str, dict] = {}
    for emp in employees:
        wo = emp.get("weekoff_days") or ["Saturday", "Sunday"]
        try:
            w1 = WEEKDAY_NAMES.index(wo[0]) if wo and len(wo) > 0 and wo[0] else 5
            w2 = WEEKDAY_NAMES.index(wo[1]) if wo and len(wo) > 1 and wo[1] else 6
        except ValueError:
            w1, w2 = 5, 6

        daily = {}
        for d_iso in dates_iso:
            y, m, dd = map(int, d_iso.split("-"))
            wkd = date_cls(y, m, dd).weekday()
            daily[d_iso] = "WO" if wkd in (w1, w2) else "WD"

        schedules[emp["id"]] = {
            "emp_id": emp["emp_id"],
            "name": emp["name"],
            "email": emp["email"],
            "is_secops": emp.get("is_secops", False),
            "soc_level": emp.get("soc_level", ""),
            "assigned_shift": emp.get("assigned_shift", ""),
            "weekoff_days": list(emp.get("weekoff_days") or ["Saturday", "Sunday"]),
            "daily_status": daily,
        }

    for emp_internal_id, leave_dates in approved_leaves.items():
        if emp_internal_id in schedules:
            for d_iso in leave_dates:
                if d_iso in schedules[emp_internal_id]["daily_status"]:
                    schedules[emp_internal_id]["daily_status"][d_iso] = "L"

    for r in replacements:
        rid = r.get("replacement_internal_id")
        if not rid or rid not in schedules:
            continue
        try:
            sd = date_cls.fromisoformat(r["start_date"])
            ed = date_cls.fromisoformat(r["end_date"])
        except (ValueError, KeyError):
            continue
        cur = sd
        while cur <= ed:
            d_iso = cur.isoformat()
            if d_iso in schedules[rid]["daily_status"]:
                schedules[rid]["daily_status"][d_iso] = "Adj"
            cur += timedelta(days=1)

    return {"year": year, "month": month, "dates": dates_iso, "schedules": schedules}


async def get_employees_for_month(year: int, month: int) -> List[dict]:
    """Return employees with per-month shift+weekoff overrides applied.

    If a monthly_assignments doc exists for (year,month), its per-employee
    assignments override the employee's default assigned_shift/weekoff_days.
    """
    employees = await db.employees.find({}, {"_id": 0}).to_list(1000)
    snapshot = await db.monthly_assignments.find_one(
        {"year": year, "month": month}, {"_id": 0}
    )
    if snapshot and snapshot.get("assignments"):
        by_id = {a["employee_id"]: a for a in snapshot["assignments"]}
        for e in employees:
            a = by_id.get(e["id"])
            if a:
                e["assigned_shift"] = a.get("assigned_shift", e.get("assigned_shift", ""))
                e["weekoff_days"] = list(a.get("weekoff_days") or e.get("weekoff_days") or ["Saturday", "Sunday"])
    return employees


async def compute_monthly_roster(year: int, month: int) -> dict:
    """Build the monthly roster, applying month-specific overrides + leaves."""
    employees = await get_employees_for_month(year, month)

    leaves = await db.leave_requests.find(
        {"status": "APPROVED"}, {"_id": 0}
    ).to_list(5000)

    by_emp_id = {e["emp_id"]: e["id"] for e in employees}
    month_start = date_cls(year, month, 1)
    _, num_days = monthrange(year, month)
    month_end = date_cls(year, month, num_days)

    approved_leaves: Dict[str, Set[str]] = {}
    replacements: List[dict] = []
    for lr in leaves:
        try:
            sd = date_cls.fromisoformat(lr["start_date"])
            ed = date_cls.fromisoformat(lr["end_date"])
        except (ValueError, KeyError):
            continue
        if ed < month_start or sd > month_end:
            continue
        clip_sd = max(sd, month_start)
        clip_ed = min(ed, month_end)
        emp_internal = by_emp_id.get(lr["emp_id"])
        if emp_internal:
            approved_leaves.setdefault(emp_internal, set())
            cur = clip_sd
            while cur <= clip_ed:
                approved_leaves[emp_internal].add(cur.isoformat())
                cur += timedelta(days=1)

        repl_internal = by_emp_id.get(lr.get("replacement_emp_id", ""))
        if repl_internal:
            replacements.append({
                "replacement_internal_id": repl_internal,
                "start_date": clip_sd.isoformat(),
                "end_date": clip_ed.isoformat(),
            })

    roster = build_monthly_schedules(employees, year, month, approved_leaves, replacements)

    # Overlay per-day weekly-editor edits (db.roster) so changes there flow into
    # the monthly view automatically. Entries take priority over defaults but
    # DO NOT overwrite approved-leave (L) or replacement (Adj) markers, which
    # come from the leave-request approval workflow.
    weekly_entries = await db.roster.find(
        {"date": {"$gte": month_start.isoformat(), "$lte": month_end.isoformat()}},
        {"_id": 0},
    ).to_list(20000)
    for we in weekly_entries:
        emp_internal = we.get("employee_id")
        d = we.get("date")
        code = we.get("code") or ""
        if not emp_internal or not d or emp_internal not in roster["schedules"]:
            continue
        current = roster["schedules"][emp_internal]["daily_status"].get(d)
        # Preserve approved leaves & replacements set by the workflow
        if current in ("L", "Adj"):
            continue
        if code in ("WD", "WO", "L", "Adj", ""):
            roster["schedules"][emp_internal]["daily_status"][d] = code

    snapshot = await db.monthly_assignments.find_one(
        {"year": year, "month": month}, {"_id": 0}
    )
    roster["has_snapshot"] = bool(snapshot)
    roster["employees"] = sorted(
        [{
            "id": e["id"], "emp_id": e["emp_id"], "name": e["name"], "email": e["email"],
            "is_secops": e.get("is_secops", False),
            "soc_level": e.get("soc_level", ""),
            "assigned_shift": e.get("assigned_shift", ""),
            "weekoff_days": list(e.get("weekoff_days") or ["Saturday", "Sunday"]),
        } for e in employees],
        key=lambda x: (not x["is_secops"], x["assigned_shift"], x["emp_id"]),
    )
    return roster


# ---------------------------------------------------------------------------
# App + Router
# ---------------------------------------------------------------------------
app = FastAPI(title="SOC Shift Roster API")
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "SOC Shift Roster API", "status": "ok"}


# ---------- Auth ----------
@api_router.post("/auth/login")
async def login(payload: LoginRequest, request: Request, response: Response):
    email = payload.email.lower().strip()
    ip = _client_ip(request)
    identifier = f"{ip}:{email}"

    # 1) Brute-force lockout gate — silent 429 with retry-after
    locked_until = await is_login_locked(identifier)
    if locked_until:
        retry_after = max(1, int((locked_until - datetime.now(timezone.utc)).total_seconds()))
        await audit("login.locked", request, extra={"email": email})
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    user = await db.users.find_one({"email": email})

    # 2) Constant-time password verify (dummy hash when user missing) —
    #    defeats user-enumeration timing attacks.
    password_hash = user["password_hash"] if user else _DUMMY_PASSWORD_HASH
    is_valid = verify_password(payload.password, password_hash)

    if not user or not is_valid:
        await record_login_failure(identifier)
        await audit("login.failed", request, extra={"email": email})
        # Generic error — do not reveal which of email/password was wrong
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # 3) Success — clear counter, issue tokens
    await clear_login_failures(identifier)
    access = create_access_token(user["id"], user["email"], user["role"])
    refresh = create_refresh_token(user["id"])
    _set_auth_cookies(response, access, refresh)
    await audit("login.success", request, actor={"id": user["id"], "email": user["email"]})
    return {
        "id": user["id"], "email": user["email"], "name": user["name"],
        "role": user["role"], "linked_emp_id": user.get("linked_emp_id", ""),
        "access_token": access,
    }


@api_router.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    """Exchange a valid refresh cookie for a new access token.

    Rotates the refresh token as well (jti changes) so a stolen refresh token
    is only usable until the next legitimate refresh.
    """
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    new_access = create_access_token(user["id"], user["email"], user["role"])
    new_refresh = create_refresh_token(user["id"])
    _set_auth_cookies(response, new_access, new_refresh)
    await audit("token.refreshed", request, actor={"id": user["id"], "email": user["email"]})
    return {"access_token": new_access}


@api_router.get("/auth/me", response_model=UserPublic)
async def me(current_user: dict = Depends(get_current_user)):
    return UserPublic(
        id=current_user["id"], email=current_user["email"], name=current_user["name"],
        role=current_user["role"], linked_emp_id=current_user.get("linked_emp_id", ""),
    )


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/api/auth")
    # Best-effort audit (may be anonymous if cookie already stale)
    try:
        token = request.cookies.get("access_token")
        if token:
            payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM],
                                 options={"verify_exp": False})
            await audit("logout", request, actor={"id": payload.get("sub"), "email": payload.get("email")})
    except Exception:
        pass
    return {"ok": True}


# ---------- Users (admin only) ----------
@api_router.get("/users", response_model=List[UserPublic])
async def list_users(current_user: dict = Depends(require_roles("admin"))):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("email", 1).to_list(1000)
    return [UserPublic(
        id=d["id"], email=d["email"], name=d["name"], role=d["role"],
        linked_emp_id=d.get("linked_emp_id", ""),
    ) for d in docs]


@api_router.post("/users", response_model=UserPublic)
async def create_user(payload: UserCreate, request: Request,
                       current_user: dict = Depends(require_roles("admin", "manager"))):
    # Managers can only create 'user' role; admins can create any role
    if current_user["role"] == "manager" and payload.role != "user":
        raise HTTPException(status_code=403, detail="Managers can only create users with role 'user'")
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    validate_password_strength(payload.password)
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")
    linked = (payload.linked_emp_id or "").strip()
    if linked:
        if not await db.employees.find_one({"emp_id": linked}):
            raise HTTPException(status_code=400, detail="Linked employee not found")
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": payload.name.strip(),
        "role": payload.role,
        "linked_emp_id": linked,
        "password_hash": hash_password(payload.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user["email"],
    }
    await db.users.insert_one(doc)
    await audit("user.created", request, actor=current_user, target=doc["email"],
                extra={"role": doc["role"], "linked_emp_id": doc["linked_emp_id"]})
    return UserPublic(id=doc["id"], email=doc["email"], name=doc["name"],
                      role=doc["role"], linked_emp_id=doc["linked_emp_id"])


@api_router.post("/users/with-employee")
async def create_user_with_employee(
    payload: UserWithEmployeeCreate,
    request: Request,
    current_user: dict = Depends(require_roles("admin")),
):
    """Admin-only: create a user account AND a linked employee record in one step.
    Auto-generates the next sequential Employee ID (E001, E002, …).
    The employee is matched to the user by shared email address.
    """
    validate_password_strength(payload.password)
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")
    if await db.employees.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="An employee with this email already exists")

    # Auto-generate next sequential emp_id
    existing_emps = await db.employees.find({}, {"emp_id": 1, "_id": 0}).to_list(10000)
    max_num = 0
    for e in existing_emps:
        try:
            eid = e.get("emp_id", "")
            if eid and eid[0] == "E":
                num = int(eid[1:])
                if num > max_num:
                    max_num = num
        except (ValueError, TypeError):
            pass
    new_emp_id = f"E{(max_num + 1):03d}"

    # Auto-assign a week-off pair and shift that balances existing employees
    existing_emps_full = await db.employees.find({}, {"weekoff_days": 1, "assigned_shift": 1, "_id": 0}).to_list(10000)
    pair_counts = {tuple(p): 0 for p in WEEKOFF_PAIRS}
    shift_counts = {"M": 0, "A": 0, "N": 0}

    for e in existing_emps_full:
        wo = tuple(e.get("weekoff_days") or ["Saturday", "Sunday"])
        if wo in pair_counts:
            pair_counts[wo] += 1
        
        sh = e.get("assigned_shift")
        if sh in shift_counts:
            shift_counts[sh] += 1
    
    # Pick one of the pairs with the lowest count to balance them out
    min_count = min(pair_counts.values())
    best_pair = next(p for p, c in pair_counts.items() if c == min_count)

    # Pick a shift with the lowest count randomly to balance them out
    min_shift_count = min(shift_counts.values())
    best_shifts = [s for s, c in shift_counts.items() if c == min_shift_count]
    best_shift = random.choice(best_shifts)

    # L3 rule override: L3 employees always get Sat/Sun off and never Night shift
    if payload.soc_level == "L3":
        best_pair = tuple(L3_WEEKOFF)
        if best_shift == "N":
            best_shift = "M"

    now = datetime.now(timezone.utc).isoformat()
    user_doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": payload.name.strip(),
        "role": payload.role,
        "linked_emp_id": new_emp_id,
        "password_hash": hash_password(payload.password),
        "created_at": now,
        "created_by": current_user["email"],
    }
    emp_doc = {
        "id": str(uuid.uuid4()),
        "emp_id": new_emp_id,
        "name": payload.name.strip(),
        "email": email,
        "is_secops": payload.is_secops,
        "soc_level": payload.soc_level or "",
        "assigned_shift": best_shift,
        "weekoff_days": list(best_pair),
        "created_at": now,

    }

    await db.users.insert_one(user_doc)
    await db.employees.insert_one(emp_doc)
    await audit("user.created", request, actor=current_user, target=email,
                extra={"role": payload.role, "emp_id": new_emp_id, "linked": True})
    logger.info(f"Created user+employee: {email} -> {new_emp_id}")

    return {
        "user": {
            "id": user_doc["id"], "email": email,
            "name": payload.name.strip(), "role": payload.role,
            "linked_emp_id": new_emp_id,
        },
        "emp_id": new_emp_id,
    }


@api_router.patch("/users/{user_id}", response_model=UserPublic)
async def update_user(user_id: str, payload: UserUpdate,
                       current_user: dict = Depends(require_roles("admin"))):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    update: dict = {}
    if payload.name is not None:
        update["name"] = payload.name.strip()
    if payload.role is not None:
        if payload.role not in ROLES:
            raise HTTPException(status_code=400, detail="Invalid role")
        # Prevent demoting the last admin
        if target["role"] == "admin" and payload.role != "admin":
            admin_count = await db.users.count_documents({"role": "admin"})
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last admin")
        update["role"] = payload.role
    if payload.password:
        update["password_hash"] = hash_password(payload.password)
    if payload.linked_emp_id is not None:
        linked = payload.linked_emp_id.strip()
        if linked and not await db.employees.find_one({"emp_id": linked}):
            raise HTTPException(status_code=400, detail="Linked employee not found")
        update["linked_emp_id"] = linked
    if update:
        await db.users.update_one({"id": user_id}, {"$set": update})
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return UserPublic(id=doc["id"], email=doc["email"], name=doc["name"],
                      role=doc["role"], linked_emp_id=doc.get("linked_emp_id", ""))


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, current_user: dict = Depends(require_roles("admin"))):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if target["role"] == "admin":
        admin_count = await db.users.count_documents({"role": "admin"})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    await db.users.delete_one({"id": user_id})
    # Cascade: delete the linked employee and their roster entries
    linked_emp_id = (target.get("linked_emp_id") or "").strip()
    if linked_emp_id:
        emp = await db.employees.find_one({"emp_id": linked_emp_id}, {"_id": 0})
        if emp:
            await db.employees.delete_one({"emp_id": linked_emp_id})
            await db.roster.delete_many({"employee_id": emp["id"]})
            logger.info(f"Cascade deleted employee {linked_emp_id} (linked to user {target.get('email')})")
    return {"ok": True}


# ---------- Employees ----------
@api_router.get("/employees", response_model=List[Employee])
async def list_employees(current_user: dict = Depends(get_current_user)):
    docs = await db.employees.find({}, {"_id": 0}).sort("emp_id", 1).to_list(1000)
    return docs


@api_router.post("/employees", response_model=Employee)
async def create_employee(payload: EmployeeCreate,
                           current_user: dict = Depends(require_roles("admin", "manager"))):
    if await db.employees.find_one({"emp_id": payload.emp_id}):
        raise HTTPException(status_code=400, detail="Employee ID already exists")
    doc = {
        "id": str(uuid.uuid4()),
        "emp_id": payload.emp_id.strip(),
        "name": payload.name.strip(),
        "email": payload.email.lower().strip(),
        "is_secops": payload.is_secops,
        "soc_level": payload.soc_level or "",
        "assigned_shift": "",
        "weekoff_days": ["Saturday", "Sunday"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.employees.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---------- Bulk-import analysts (employees) from parsed sheet ----------
class AnalystImportRow(BaseModel):
    name: Optional[str] = ""
    emp_id: Optional[str] = ""
    email: Optional[str] = ""
    level: Optional[str] = ""
    is_secops: Optional[bool] = False


class AnalystImportRequest(BaseModel):
    rows: List[AnalystImportRow]


def _slug_email(name: str) -> str:
    slug = "".join(c.lower() for c in name if c.isalnum())
    return f"{slug or 'analyst'}@company.com"


def _normalize_level(s: str) -> str:
    if not s:
        return ""
    v = s.strip().upper().replace(" ", "")
    if v in ("L1", "L2", "L3"):
        return v
    if v in ("LEVEL1", "LVL1", "TIER1", "1"):
        return "L1"
    if v in ("LEVEL2", "LVL2", "TIER2", "2"):
        return "L2"
    if v in ("LEVEL3", "LVL3", "TIER3", "3"):
        return "L3"
    return ""


@api_router.post("/employees/import")
async def import_analysts(payload: AnalystImportRequest,
                           current_user: dict = Depends(require_roles("admin", "manager"))):
    """Bulk-create employees (analysts) from a parsed sheet.

    For each row:
      - `name` is required.
      - If `emp_id` is blank, the next sequential ID (E###) is assigned.
      - If `email` is blank, a slugified `<name>@company.com` placeholder is used.
      - `level` is normalized to L1 / L2 / L3 (empty allowed).
      - Rows are skipped (not aborted) on duplicates or validation failures; the
        response reports every skipped row with a reason.
      - Balanced default weekoff pair + shift is chosen from remaining pool
        counts; L3 analysts always get Sat/Sun off and are never assigned Night.
    """
    if not payload.rows:
        raise HTTPException(status_code=400, detail="No rows provided")

    existing = await db.employees.find({}, {"_id": 0}).to_list(10000)
    existing_ids = {e["emp_id"].upper() for e in existing if e.get("emp_id")}
    existing_emails = {e["email"].lower() for e in existing if e.get("email")}

    max_num = 0
    for e in existing:
        eid = e.get("emp_id", "")
        if eid and eid[0].upper() == "E":
            try:
                max_num = max(max_num, int(eid[1:]))
            except (ValueError, TypeError):
                pass

    pair_counts = {tuple(p): 0 for p in WEEKOFF_PAIRS}
    shift_counts = {"M": 0, "A": 0, "N": 0}
    for e in existing:
        wo = tuple(e.get("weekoff_days") or ["Saturday", "Sunday"])
        if wo in pair_counts:
            pair_counts[wo] += 1
        sh = e.get("assigned_shift")
        if sh in shift_counts:
            shift_counts[sh] += 1

    created: List[dict] = []
    skipped: List[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for idx, row in enumerate(payload.rows):
        name = (row.name or "").strip()
        if not name:
            skipped.append({"row": idx + 1, "name": "", "reason": "missing name"})
            continue

        # Resolve emp_id
        emp_id = (row.emp_id or "").strip().upper()
        if emp_id:
            if emp_id in existing_ids:
                skipped.append({"row": idx + 1, "name": name, "emp_id": emp_id,
                                "reason": "emp_id already exists"})
                continue
        else:
            max_num += 1
            emp_id = f"E{max_num:03d}"
            while emp_id in existing_ids:
                max_num += 1
                emp_id = f"E{max_num:03d}"

        # Resolve email
        email = (row.email or "").strip().lower()
        if not email:
            base = _slug_email(name)
            candidate, suffix = base, 1
            local, domain = base.split("@", 1)
            while candidate in existing_emails:
                suffix += 1
                candidate = f"{local}{suffix}@{domain}"
            email = candidate
        elif email in existing_emails:
            skipped.append({"row": idx + 1, "name": name, "emp_id": emp_id,
                            "reason": "email already exists"})
            continue

        soc_level = _normalize_level(row.level or "")
        is_secops = bool(row.is_secops)

        # Balanced default shift + weekoff
        min_shift = min(shift_counts.values())
        best_shifts = [s for s, c in shift_counts.items() if c == min_shift]
        chosen_shift = random.choice(best_shifts)

        min_pair = min(pair_counts.values())
        best_pair = next(p for p, c in pair_counts.items() if c == min_pair)

        # L3 override
        if soc_level == "L3":
            best_pair = tuple(L3_WEEKOFF)
            if chosen_shift == "N":
                chosen_shift = "M"

        doc = {
            "id": str(uuid.uuid4()),
            "emp_id": emp_id,
            "name": name,
            "email": email,
            "is_secops": is_secops,
            "soc_level": soc_level,
            "assigned_shift": chosen_shift,
            "weekoff_days": list(best_pair),
            "created_at": now_iso,
        }
        await db.employees.insert_one(doc)

        existing_ids.add(emp_id)
        existing_emails.add(email)
        pair_counts[tuple(best_pair)] += 1
        shift_counts[chosen_shift] += 1

        created.append({
            "emp_id": emp_id, "name": name, "email": email,
            "soc_level": soc_level, "is_secops": is_secops,
            "assigned_shift": chosen_shift, "weekoff_days": list(best_pair),
        })

    logger.info(f"Imported {len(created)} analysts, skipped {len(skipped)}")
    return {"ok": True, "created_count": len(created), "created": created, "skipped": skipped}


@api_router.patch("/employees/{internal_id}", response_model=Employee)
async def update_employee(internal_id: str, payload: EmployeeUpdate,
                           current_user: dict = Depends(require_roles("admin", "manager"))):
    update = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    # Only admin can change soc_level
    if "soc_level" in update and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admin can change SOC level")
    if "emp_id" in update:
        clash = await db.employees.find_one({"emp_id": update["emp_id"], "id": {"$ne": internal_id}})
        if clash:
            raise HTTPException(status_code=400, detail="Employee ID already exists")

    # L3 rule enforcement: L3 employees must always have Sat/Sun off and never Night shift.
    # Compute the resulting soc_level for this update to decide whether to enforce the rule.
    existing = await db.employees.find_one({"id": internal_id}, {"_id": 0, "soc_level": 1})
    resulting_soc = update.get("soc_level", (existing or {}).get("soc_level", ""))
    if resulting_soc == "L3":
        update["weekoff_days"] = list(L3_WEEKOFF)
        if update.get("assigned_shift") == "N":
            update["assigned_shift"] = "M"

    if update:
        result = await db.employees.update_one({"id": internal_id}, {"$set": update})
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Employee not found")
    doc = await db.employees.find_one({"id": internal_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Employee not found")
    return doc


@api_router.delete("/employees/{internal_id}")
async def delete_employee(internal_id: str,
                           current_user: dict = Depends(require_roles("admin", "manager"))):
    emp = await db.employees.find_one({"id": internal_id}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    await db.employees.delete_one({"id": internal_id})
    await db.roster.delete_many({"employee_id": internal_id})
    # Cascade: delete the linked user account (matched by linked_emp_id)
    linked_user = await db.users.find_one({"linked_emp_id": emp["emp_id"]}, {"_id": 0})
    if linked_user:
        # Protect the last admin from cascade deletion
        if linked_user.get("role") == "admin":
            admin_count = await db.users.count_documents({"role": "admin"})
            if admin_count <= 1:
                logger.warning("Skipped cascade-deleting last admin user during employee delete")
            else:
                await db.users.delete_one({"id": linked_user["id"]})
                logger.info(f"Cascade deleted user {linked_user.get('email')} (linked to employee {emp['emp_id']})")
        else:
            await db.users.delete_one({"id": linked_user["id"]})
            logger.info(f"Cascade deleted user {linked_user.get('email')} (linked to employee {emp['emp_id']})")
    return {"ok": True}


# ---------- Weekly Roster (manager+admin) ----------
@api_router.get("/roster")
async def get_roster(start_date: str, end_date: str,
                      current_user: dict = Depends(get_current_user)):
    docs = await db.roster.find(
        {"date": {"$gte": start_date, "$lte": end_date}}, {"_id": 0},
    ).to_list(10000)
    return {"entries": docs}


@api_router.post("/roster/bulk")
async def save_roster_bulk(payload: RosterBulk,
                            current_user: dict = Depends(require_roles("admin", "manager"))):
    if not payload.entries:
        return {"saved": 0}
    saved = 0
    for e in payload.entries:
        if e.code == "":
            await db.roster.delete_one({"employee_id": e.employee_id, "date": e.date})
        else:
            await db.roster.update_one(
                {"employee_id": e.employee_id, "date": e.date},
                {"$set": {
                    "employee_id": e.employee_id, "date": e.date,
                    "code": e.code, "sub_type": e.sub_type or "",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )
        saved += 1
    return {"saved": saved}


# ---------- Monthly Roster ----------
@api_router.get("/roster/monthly")
async def get_monthly_roster(year: int, month: int,
                              current_user: dict = Depends(get_current_user)):
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    return await compute_monthly_roster(year, month)


@api_router.post("/roster/monthly/reshuffle")
async def reshuffle_monthly(year: Optional[int] = None, month: Optional[int] = None,
                             current_user: dict = Depends(require_roles("admin", "manager"))):
    """Reshuffle assignments. If year+month provided, snapshot is stored for
    that specific month. Otherwise it updates the employees' default assignment
    (legacy behaviour).
    """
    employees = await db.employees.find({}, {"_id": 0}).to_list(1000)
    if not employees:
        raise HTTPException(status_code=400, detail="No employees to assign")
    assign_shifts_and_weekoffs(employees)

    if year is not None and month is not None:
        if month < 1 or month > 12:
            raise HTTPException(status_code=400, detail="Invalid month")
        assignments = [{
            "employee_id": e["id"],
            "assigned_shift": e.get("assigned_shift", ""),
            "weekoff_days": list(e.get("weekoff_days") or []),
        } for e in employees]
        await db.monthly_assignments.update_one(
            {"year": year, "month": month},
            {"$set": {
                "year": year, "month": month,
                "assignments": assignments,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_by": current_user.get("name") or current_user.get("email"),
            }},
            upsert=True,
        )
        return {"ok": True, "assigned": len(employees), "year": year, "month": month, "scope": "month"}

    # Legacy global reassignment
    for e in employees:
        await db.employees.update_one(
            {"id": e["id"]},
            {"$set": {
                "assigned_shift": e["assigned_shift"],
                "weekoff_days": e["weekoff_days"],
            }},
        )
    return {"ok": True, "assigned": len(employees), "scope": "global"}


@api_router.delete("/roster/monthly")
async def clear_monthly_snapshot(year: int, month: int,
                                  current_user: dict = Depends(require_roles("admin", "manager"))):
    """Remove the saved snapshot for a month (reverts to default employee assignment)."""
    res = await db.monthly_assignments.delete_one({"year": year, "month": month})
    return {"ok": True, "deleted": res.deleted_count}


# ---------- Manual per-employee shift assignment (drag-drop / import) ----------
class MonthlyAssignmentEntry(BaseModel):
    employee_id: str
    assigned_shift: ShiftCode
    weekoff_days: Optional[List[str]] = None


class MonthlyAssignmentPatch(BaseModel):
    year: int
    month: int
    assignments: List[MonthlyAssignmentEntry]


@api_router.post("/roster/monthly/assign")
async def patch_monthly_assignments(payload: MonthlyAssignmentPatch,
                                     current_user: dict = Depends(require_roles("admin", "manager"))):
    """Apply/overwrite one or more per-employee shift assignments for a given month.

    - If a snapshot for (year, month) does not exist yet, it is initialized from
      the current default per-employee assignment (so untouched employees keep
      their existing shift/weekoff).
    - Then the provided assignments are upserted into that snapshot.
    - L3 employees are force-corrected to Sat/Sun off and never Night.
    """
    if payload.month < 1 or payload.month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    if not payload.assignments:
        raise HTTPException(status_code=400, detail="No assignments provided")

    employees = await db.employees.find({}, {"_id": 0}).to_list(1000)
    by_id = {e["id"]: e for e in employees}

    # Load or initialize snapshot
    snapshot = await db.monthly_assignments.find_one(
        {"year": payload.year, "month": payload.month}, {"_id": 0}
    )
    if snapshot and snapshot.get("assignments"):
        assignments = {a["employee_id"]: dict(a) for a in snapshot["assignments"]}
    else:
        assignments = {
            e["id"]: {
                "employee_id": e["id"],
                "assigned_shift": e.get("assigned_shift", ""),
                "weekoff_days": list(e.get("weekoff_days") or ["Saturday", "Sunday"]),
            } for e in employees
        }

    applied = 0
    skipped: List[str] = []
    for entry in payload.assignments:
        emp = by_id.get(entry.employee_id)
        if not emp:
            skipped.append(entry.employee_id)
            continue

        new_shift = entry.assigned_shift
        new_wo = list(entry.weekoff_days) if entry.weekoff_days is not None else list(
            assignments.get(entry.employee_id, {}).get("weekoff_days") or emp.get("weekoff_days") or ["Saturday", "Sunday"]
        )

        # L3 rule: Sat/Sun off, no Night
        if emp.get("soc_level") == "L3":
            new_wo = list(L3_WEEKOFF)
            if new_shift == "N":
                new_shift = "M"

        assignments[entry.employee_id] = {
            "employee_id": entry.employee_id,
            "assigned_shift": new_shift,
            "weekoff_days": new_wo,
        }
        applied += 1

    await db.monthly_assignments.update_one(
        {"year": payload.year, "month": payload.month},
        {"$set": {
            "year": payload.year, "month": payload.month,
            "assignments": list(assignments.values()),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": current_user.get("name") or current_user.get("email"),
        }},
        upsert=True,
    )
    return {"ok": True, "applied": applied, "skipped": skipped}


# ---------- Excel-import matcher: match rows to employees by name / emp_id ----------
class ImportRow(BaseModel):
    resource_name: Optional[str] = ""
    emp_id: Optional[str] = ""
    level: Optional[str] = ""
    recommended_shift: Optional[str] = ""
    existing_shift: Optional[str] = ""
    leave_dates: Optional[str] = ""
    remarks: Optional[str] = ""


class ImportRequest(BaseModel):
    year: int
    month: int
    rows: List[ImportRow]


def _normalize_shift_code(s: str) -> str:
    """Map various shift labels to M / A / N. Returns '' if not recognized."""
    if not s:
        return ""
    v = s.strip().upper()
    if v in ("M", "A", "N"):
        return v
    if v in ("MORNING", "MORN", "MOR", "DAY", "GENERAL", "GEN", "GS"):
        return "M"
    if v in ("AFTERNOON", "NOON", "EVENING", "EVE", "MID"):
        return "A"
    if v in ("NIGHT", "GRAVEYARD"):
        return "N"
    return ""


@api_router.post("/roster/monthly/import")
async def import_monthly_shifts(payload: ImportRequest,
                                 current_user: dict = Depends(require_roles("admin", "manager"))):
    """Import shift changes from a parsed leave-tracker sheet.

    Each row is matched to an employee by emp_id (if provided) or by
    resource_name (case-insensitive, first token match). Only rows with a
    recognized `recommended_shift` are applied. Unmatched rows are returned
    so the client can show them for manual correction.
    """
    if payload.month < 1 or payload.month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")

    employees = await db.employees.find({}, {"_id": 0}).to_list(1000)
    by_emp_id = {e["emp_id"].strip().upper(): e for e in employees if e.get("emp_id")}
    by_name = {e["name"].strip().lower(): e for e in employees if e.get("name")}

    matched: List[dict] = []
    unmatched: List[dict] = []
    for row in payload.rows:
        code = _normalize_shift_code(row.recommended_shift or "")
        target_name = (row.resource_name or "").strip()
        emp: Optional[dict] = None
        if row.emp_id:
            emp = by_emp_id.get(row.emp_id.strip().upper())
        if not emp and target_name:
            emp = by_name.get(target_name.lower())
        if not emp and target_name:
            # loose match: first-name only
            first = target_name.lower().split()[0]
            for k, v in by_name.items():
                if k.startswith(first):
                    emp = v
                    break
        if not emp or not code:
            unmatched.append({
                "resource_name": target_name,
                "emp_id": row.emp_id or "",
                "recommended_shift": row.recommended_shift or "",
                "reason": "no matching employee" if not emp else "unknown shift code",
            })
            continue

        # L3 rule: force to M if trying to assign Night
        if emp.get("soc_level") == "L3" and code == "N":
            code = "M"

        matched.append({
            "employee_id": emp["id"],
            "emp_id": emp["emp_id"],
            "name": emp["name"],
            "soc_level": emp.get("soc_level", ""),
            "from_shift": emp.get("assigned_shift", ""),
            "to_shift": code,
            "remarks": row.remarks or "",
        })

    if matched:
        entries = [
            MonthlyAssignmentEntry(employee_id=m["employee_id"], assigned_shift=m["to_shift"])
            for m in matched
        ]
        await patch_monthly_assignments(
            MonthlyAssignmentPatch(year=payload.year, month=payload.month, assignments=entries),
            current_user=current_user,
        )
    return {"ok": True, "applied": len(matched), "matched": matched, "unmatched": unmatched}


# ---------- Branding / Login-page logo ----------
class LoginLogoUpdate(BaseModel):
    data_url: str  # e.g. "data:image/png;base64,iVBORw0KG..."


_LOGO_MAX_BASE64_LEN = 700_000  # ~500 KB raw image after base64 encoding
_LOGO_ALLOWED_MIMES = ("image/png", "image/jpeg", "image/jpg",
                       "image/webp", "image/svg+xml", "image/gif")


@api_router.get("/settings/login-logo")
async def get_login_logo():
    """Public — used by the sign-in page before any user is authenticated."""
    doc = await db.settings.find_one({"key": "login_logo"}, {"_id": 0})
    return {"data_url": (doc or {}).get("data_url")}


@api_router.put("/settings/login-logo")
async def set_login_logo(payload: LoginLogoUpdate, request: Request,
                          current_user: dict = Depends(require_roles("admin"))):
    du = (payload.data_url or "").strip()
    if not du.startswith("data:"):
        raise HTTPException(status_code=400, detail="Must be a data URL")
    header, _, body = du.partition(",")
    if ";base64" not in header or not any(m in header for m in _LOGO_ALLOWED_MIMES):
        raise HTTPException(
            status_code=400,
            detail="Only PNG, JPG, WEBP, SVG, or GIF images are allowed (base64 encoded).",
        )
    if not body:
        raise HTTPException(status_code=400, detail="Empty image body")
    if len(du) > _LOGO_MAX_BASE64_LEN:
        raise HTTPException(
            status_code=413,
            detail=f"Logo too large. Max ~{_LOGO_MAX_BASE64_LEN // 1400}KB after encoding.",
        )
    await db.settings.update_one(
        {"key": "login_logo"},
        {"$set": {
            "key": "login_logo",
            "data_url": du,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": current_user.get("email"),
        }},
        upsert=True,
    )
    await audit("branding.logo_updated", request, actor=current_user,
                extra={"bytes": len(du)})
    return {"ok": True, "data_url": du}


@api_router.delete("/settings/login-logo")
async def clear_login_logo(request: Request,
                            current_user: dict = Depends(require_roles("admin"))):
    res = await db.settings.delete_one({"key": "login_logo"})
    await audit("branding.logo_cleared", request, actor=current_user,
                extra={"deleted": res.deleted_count})
    return {"ok": True}


# ---------- Leave Requests ----------
@api_router.post("/leaves")
async def create_leave_request(payload: LeaveRequestCreate,
                                current_user: dict = Depends(get_current_user)):
    emp = await db.employees.find_one({"emp_id": payload.emp_id}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    # Users can only request leaves for their linked employee
    if current_user["role"] == "user":
        linked = current_user.get("linked_emp_id", "")
        if not linked or linked != payload.emp_id:
            raise HTTPException(status_code=403, detail="You can only request leave for your linked employee")
    try:
        sd = date_cls.fromisoformat(payload.start_date)
        ed = date_cls.fromisoformat(payload.end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    if sd > ed:
        raise HTTPException(status_code=400, detail="Start date must be before end date")

    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "request_id": "REQ" + now.strftime("%Y%m%d%H%M%S") + uuid.uuid4().hex[:4].upper(),
        "emp_id": emp["emp_id"],
        "emp_name": emp["name"],
        "email": emp["email"],
        "start_date": sd.isoformat(),
        "end_date": ed.isoformat(),
        "reason": payload.reason.strip(),
        "replacement_emp_id": "",
        "replacement_name": "",
        "status": "PENDING",
        "submitted_at": now.isoformat(),
        "approved_at": "",
        "approved_by": "",
    }
    await db.leave_requests.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/leaves")
async def list_leaves(emp_id: Optional[str] = None, status: Optional[str] = None,
                      year: Optional[int] = None, month: Optional[int] = None,
                      current_user: dict = Depends(get_current_user)):
    q: dict = {}
    # Users can only see their own
    if current_user["role"] == "user":
        linked = current_user.get("linked_emp_id", "")
        if not linked:
            return []
        q["emp_id"] = linked
    elif emp_id:
        q["emp_id"] = emp_id
    if status:
        q["status"] = status.upper()
    docs = await db.leave_requests.find(q, {"_id": 0}).sort("submitted_at", -1).to_list(2000)
    # Optional month overlap filter (for calendar view)
    if year is not None and month is not None:
        try:
            month_start = date_cls(year, month, 1)
            _, num_days = monthrange(year, month)
            month_end = date_cls(year, month, num_days)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid year/month")

        def overlaps(lr: dict) -> bool:
            sd = ed = None
            try:
                sd = date_cls.fromisoformat(lr["start_date"])
                ed = date_cls.fromisoformat(lr["end_date"])
            except (ValueError, KeyError, TypeError):
                return False
            if sd is None or ed is None:
                return False
            return not (ed < month_start or sd > month_end)

        docs = [d for d in docs if overlaps(d)]
    return docs


@api_router.post("/leaves/{leave_id}/approve")
async def approve_leave(leave_id: str, payload: LeaveApproveRequest,
                         current_user: dict = Depends(require_roles("admin", "manager"))):
    lr = await db.leave_requests.find_one({"id": leave_id})
    if not lr:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if lr["status"] != "PENDING":
        raise HTTPException(status_code=400, detail=f"Already {lr['status'].lower()}")
    if not payload.replacement_emp_id:
        raise HTTPException(status_code=400, detail="Replacement employee is required")
    if payload.replacement_emp_id == lr["emp_id"]:
        raise HTTPException(status_code=400, detail="Replacement must be a different employee")
    repl = await db.employees.find_one({"emp_id": payload.replacement_emp_id}, {"_id": 0})
    if not repl:
        raise HTTPException(status_code=404, detail="Replacement employee not found")

    await db.leave_requests.update_one(
        {"id": leave_id},
        {"$set": {
            "status": "APPROVED",
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "approved_by": current_user.get("name") or current_user.get("email"),
            "replacement_emp_id": repl["emp_id"],
            "replacement_name": repl["name"],
        }},
    )
    return {"ok": True}


@api_router.post("/leaves/{leave_id}/reject")
async def reject_leave(leave_id: str,
                        current_user: dict = Depends(require_roles("admin", "manager"))):
    lr = await db.leave_requests.find_one({"id": leave_id})
    if not lr:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if lr["status"] != "PENDING":
        raise HTTPException(status_code=400, detail=f"Already {lr['status'].lower()}")
    await db.leave_requests.update_one(
        {"id": leave_id},
        {"$set": {
            "status": "REJECTED",
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "approved_by": current_user.get("name") or current_user.get("email"),
        }},
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# App wiring
# ---------------------------------------------------------------------------
app.include_router(api_router)


# --- Strict CORS allowlist (no wildcard when credentials are used) ---
def _parse_cors_origins() -> List[str]:
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if not raw or raw == "*":
        # In production this is a hard failure. In dev we fall back to a
        # localhost allowlist so the app still boots locally.
        if os.environ.get("APP_ENV", "dev").lower() == "production":
            raise RuntimeError(
                "CORS_ORIGINS must be an explicit comma-separated origin list "
                "in production (not '*'). e.g. CORS_ORIGINS=\"https://app.example.com\""
            )
        return ["http://localhost:3000"]
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


_ALLOWED_ORIGINS = _parse_cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Retry-After"],
    max_age=600,
)


# --- Security headers middleware ---
from starlette.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        # Applied to every response, including errors
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "geolocation=(), microphone=(), camera=(), payment=()"
        )
        # HSTS is only meaningful over HTTPS
        if COOKIE_SECURE:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
            )
        # Minimal CSP for the API surface (frontend is served separately)
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        )
        return response


app.add_middleware(SecurityHeadersMiddleware)


# --- Generic exception handler: never leak stack traces ---
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled error on {request.method} {request.url.path}: {exc}")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request: Request, exc: RequestValidationError):
    # Preserve field-level detail but strip internal error metadata
    errors = []
    for err in exc.errors():
        errors.append({
            "loc": err.get("loc"),
            "msg": err.get("msg"),
            "type": err.get("type"),
        })
    return JSONResponse(status_code=422, content={"detail": errors})


async def seed_employees_if_empty():
    count = await db.employees.count_documents({})
    if count > 0:
        any_old = await db.employees.find_one({"$or": [{"email": {"$exists": False}}, {"level": {"$exists": True}}]})
        if not any_old:
            # Backfill soc_level for existing employees missing it
            await db.employees.update_many(
                {"soc_level": {"$exists": False}},
                {"$set": {"soc_level": ""}},
            )
            return
        logger.info("Detected legacy employee schema → wiping and re-seeding")
        await db.employees.delete_many({})
        await db.roster.delete_many({})
        await db.leave_requests.delete_many({})
        await db.monthly_assignments.delete_many({})

    employees = []
    for i, (n, e, s, lvl) in enumerate(SEED_EMPLOYEES, 1):
        employees.append({
            "id": str(uuid.uuid4()),
            "emp_id": f"E{i:03d}",
            "name": n,
            "email": e,
            "is_secops": s,
            "soc_level": lvl,
            "assigned_shift": "",
            "weekoff_days": ["Saturday", "Sunday"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    assign_shifts_and_weekoffs(employees)
    await db.employees.insert_many(employees)
    logger.info(f"Seeded {len(employees)} employees with shift assignments")


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)

    try:
        existing_emp_indexes = await db.employees.index_information()
        for idx_name in existing_emp_indexes:
            if idx_name == "employee_id_1":
                await db.employees.drop_index("employee_id_1")
                logger.info("Dropped legacy index employees.employee_id_1")
    except Exception as ex:
        logger.warning(f"Index cleanup skipped: {ex}")

    await db.employees.create_index("id", unique=True)
    await db.employees.create_index("emp_id", unique=True)
    await db.roster.create_index([("employee_id", 1), ("date", 1)], unique=True)
    await db.leave_requests.create_index("id", unique=True)
    await db.leave_requests.create_index("emp_id")
    await db.leave_requests.create_index("status")
    await db.monthly_assignments.create_index([("year", 1), ("month", 1)], unique=True)

    # --- Security-related indexes ---
    await db.login_attempts.create_index("identifier", unique=True)
    await db.audit_log.create_index("ts")
    await db.audit_log.create_index("event")
    await db.audit_log.create_index("actor_email")

    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@roster.app").lower().strip()
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin@2026")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "System Administrator",
            "role": "admin",
            "linked_emp_id": "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Seeded admin user: {admin_email}")
    else:
        # Ensure existing admin has the right role and current password
        updates = {}
        if existing.get("role") != "admin":
            updates["role"] = "admin"
        if "linked_emp_id" not in existing:
            updates["linked_emp_id"] = ""
        if not verify_password(admin_password, existing["password_hash"]):
            updates["password_hash"] = hash_password(admin_password)
        if updates:
            await db.users.update_one({"email": admin_email}, {"$set": updates})
            logger.info("Updated admin user fields from .env")

    # Backfill linked_emp_id for users missing it
    await db.users.update_many(
        {"linked_emp_id": {"$exists": False}},
        {"$set": {"linked_emp_id": ""}},
    )

    # L3 rule backfill: L3 employees must always have Sat/Sun off; if any L3
    # employee has a Night shift assigned, switch them to Morning.
    l3_wo_res = await db.employees.update_many(
        {"soc_level": "L3", "weekoff_days": {"$ne": list(L3_WEEKOFF)}},
        {"$set": {"weekoff_days": list(L3_WEEKOFF)}},
    )
    l3_shift_res = await db.employees.update_many(
        {"soc_level": "L3", "assigned_shift": "N"},
        {"$set": {"assigned_shift": "M"}},
    )
    if l3_wo_res.modified_count or l3_shift_res.modified_count:
        logger.info(
            f"L3 backfill: {l3_wo_res.modified_count} weekoffs → Sat/Sun, "
            f"{l3_shift_res.modified_count} Night → Morning"
        )

    # Auto-seeding disabled: employees are created manually by the admin via the UI.
    # await seed_employees_if_empty()


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
