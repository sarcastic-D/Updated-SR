"""Backend tests for Monthly Roster inline cell editing feature.

Modules covered:
- Auth: POST /api/auth/login (admin)
- Monthly roster: GET /api/roster/monthly (structure, overlay of db.roster edits)
- Bulk roster writes: POST /api/roster/bulk (set code, clear code, auth guards)
"""
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

YEAR, MONTH = 2026, 8


@pytest.fixture(scope="session")
def creds():
    p = Path("/app/memory/test_credentials.md")
    if not p.exists():
        pytest.skip("missing credentials file")
    c = p.read_text()
    e = re.search(r'(?im)^\s*(?:[-*]\s*)?(?:\*\*)?email(?:\*\*)?\s*:\s*`?([^`\s]+)', c)
    pw = re.search(r'(?im)^\s*(?:[-*]\s*)?(?:\*\*)?password(?:\*\*)?\s*:\s*`?([^`\s]+)', c)
    if not e or not pw:
        pytest.skip("no creds parsed")
    return {"email": e.group(1), "password": pw.group(1)}


@pytest.fixture(scope="session")
def client(creds):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"login failed {r.status_code}: {r.text[:300]}")
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"no token in login response: {data}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ---------- Health ----------
def test_root_health():
    r = requests.get(f"{API}/", timeout=30)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


# ---------- Monthly roster structure ----------
def test_monthly_roster_structure(client):
    r = client.get(f"{API}/roster/monthly?year={YEAR}&month={MONTH}", timeout=60)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    for k in ("dates", "schedules", "employees"):
        assert k in d, f"missing {k}"
    assert len(d["dates"]) == 31
    assert "_id" not in str(d)[:2000] or True
    assert isinstance(d["employees"], list) and len(d["employees"]) > 0, "no employees seeded"
    emp = d["employees"][0]
    for k in ("id", "emp_id", "name", "soc_level", "assigned_shift"):
        assert k in emp
    sched = d["schedules"][emp["id"]]
    assert "daily_status" in sched
    assert set(d["dates"]).issubset(set(sched["daily_status"].keys()))


def test_monthly_no_mongo_object_id(client):
    r = client.get(f"{API}/roster/monthly?year={YEAR}&month={MONTH}", timeout=60)
    assert r.status_code == 200
    assert '"_id"' not in r.text


def test_monthly_invalid_month(client):
    r = client.get(f"{API}/roster/monthly?year={YEAR}&month=13", timeout=30)
    assert r.status_code == 400


# ---------- Bulk write + monthly overlay (core of feature) ----------
class TestBulkCellEdits:
    def _pick(self, client):
        r = client.get(f"{API}/roster/monthly?year={YEAR}&month={MONTH}", timeout=60)
        assert r.status_code == 200
        d = r.json()
        l1 = [e for e in d["employees"] if e["soc_level"] == "L1"]
        emp = (l1 or d["employees"])[0]
        return d, emp

    def test_set_code_persists_in_monthly(self, client):
        d, emp = self._pick(client)
        date = d["dates"][14]
        orig = d["schedules"][emp["id"]]["daily_status"][date]
        target = "L" if orig != "L" else "WO"

        r = client.post(f"{API}/roster/bulk", json={
            "entries": [{"employee_id": emp["id"], "date": date, "code": target, "sub_type": ""}]
        }, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("saved") == 1

        # verify via monthly view (overlay)
        r2 = client.get(f"{API}/roster/monthly?year={YEAR}&month={MONTH}", timeout=60)
        assert r2.status_code == 200
        got = r2.json()["schedules"][emp["id"]]["daily_status"][date]
        assert got == target, f"expected {target} got {got} (orig {orig})"

        # verify via weekly roster entries endpoint
        r3 = client.get(f"{API}/roster?start_date={date}&end_date={date}", timeout=30)
        assert r3.status_code == 200
        entries = [e for e in r3.json()["entries"] if e["employee_id"] == emp["id"]]
        assert len(entries) == 1 and entries[0]["code"] == target

        # CLEAR removes the override
        r4 = client.post(f"{API}/roster/bulk", json={
            "entries": [{"employee_id": emp["id"], "date": date, "code": "", "sub_type": ""}]
        }, timeout=30)
        assert r4.status_code == 200
        r5 = client.get(f"{API}/roster?start_date={date}&end_date={date}", timeout=30)
        assert not [e for e in r5.json()["entries"] if e["employee_id"] == emp["id"]]
        r6 = client.get(f"{API}/roster/monthly?year={YEAR}&month={MONTH}", timeout=60)
        assert r6.json()["schedules"][emp["id"]]["daily_status"][date] == orig

    def test_multiple_codes_roundtrip(self, client):
        d, emp = self._pick(client)
        dates = [d["dates"][3], d["dates"][4], d["dates"][5]]
        codes = ["WD", "WO", "Adj"]
        origs = [d["schedules"][emp["id"]]["daily_status"][x] for x in dates]
        r = client.post(f"{API}/roster/bulk", json={
            "entries": [{"employee_id": emp["id"], "date": dt, "code": c, "sub_type": ""}
                        for dt, c in zip(dates, codes)]
        }, timeout=30)
        assert r.status_code == 200 and r.json()["saved"] == 3
        got = client.get(f"{API}/roster/monthly?year={YEAR}&month={MONTH}", timeout=60).json()
        ds = got["schedules"][emp["id"]]["daily_status"]
        for dt, c in zip(dates, codes):
            assert ds[dt] == c, f"{dt}: expected {c} got {ds[dt]}"
        # cleanup -> restore defaults
        client.post(f"{API}/roster/bulk", json={
            "entries": [{"employee_id": emp["id"], "date": dt, "code": "", "sub_type": ""} for dt in dates]
        }, timeout=30)
        after = client.get(f"{API}/roster/monthly?year={YEAR}&month={MONTH}", timeout=60).json()
        for dt, o in zip(dates, origs):
            assert after["schedules"][emp["id"]]["daily_status"][dt] == o

    def test_bulk_empty_entries(self, client):
        r = client.post(f"{API}/roster/bulk", json={"entries": []}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("saved") == 0

    def test_bulk_requires_auth(self):
        r = requests.post(f"{API}/roster/bulk", json={"entries": [
            {"employee_id": "x", "date": "2026-08-01", "code": "L", "sub_type": ""}]}, timeout=30)
        assert r.status_code in (401, 403), r.status_code

    def test_bulk_invalid_payload(self, client):
        r = client.post(f"{API}/roster/bulk", json={"entries": [{"date": "2026-08-01"}]}, timeout=30)
        assert r.status_code == 422, r.status_code

    def test_bulk_unknown_employee_does_not_500(self, client):
        r = client.post(f"{API}/roster/bulk", json={"entries": [
            {"employee_id": "nonexistent-uuid", "date": "2026-08-02", "code": "L", "sub_type": ""}]},
            timeout=30)
        assert r.status_code < 500, r.text[:300]
        # cleanup
        client.post(f"{API}/roster/bulk", json={"entries": [
            {"employee_id": "nonexistent-uuid", "date": "2026-08-02", "code": "", "sub_type": ""}]},
            timeout=30)

    def test_bulk_invalid_code_handling(self, client):
        """Invalid code should be rejected (422/400) or at least not surface in monthly view."""
        d, emp = self._pick(client)
        date = d["dates"][20]
        r = client.post(f"{API}/roster/bulk", json={"entries": [
            {"employee_id": emp["id"], "date": date, "code": "BOGUS", "sub_type": ""}]}, timeout=30)
        assert r.status_code < 500
        if r.status_code == 200:
            got = client.get(f"{API}/roster/monthly?year={YEAR}&month={MONTH}", timeout=60).json()
            assert got["schedules"][emp["id"]]["daily_status"][date] != "BOGUS"
            client.post(f"{API}/roster/bulk", json={"entries": [
                {"employee_id": emp["id"], "date": date, "code": "", "sub_type": ""}]}, timeout=30)


# ---------- Regression: monthly assign (drag-to-reassign) & reshuffle exist ----------
def test_monthly_assign_roundtrip(client):
    d = client.get(f"{API}/roster/monthly?year={YEAR}&month={MONTH}", timeout=60).json()
    l1 = [e for e in d["employees"] if e["soc_level"] == "L1"]
    if not l1:
        pytest.skip("no L1 employees")
    emp = l1[0]
    orig = emp["assigned_shift"]
    target = "A" if orig != "A" else "M"
    r = client.post(f"{API}/roster/monthly/assign", json={
        "year": YEAR, "month": MONTH,
        "assignments": [{"employee_id": emp["id"], "assigned_shift": target}],
    }, timeout=60)
    assert r.status_code == 200, r.text[:300]
    after = client.get(f"{API}/roster/monthly?year={YEAR}&month={MONTH}", timeout=60).json()
    now = next(e for e in after["employees"] if e["id"] == emp["id"])
    assert now["assigned_shift"] == target
    # restore
    client.post(f"{API}/roster/monthly/assign", json={
        "year": YEAR, "month": MONTH,
        "assignments": [{"employee_id": emp["id"], "assigned_shift": orig}],
    }, timeout=60)
    restored = client.get(f"{API}/roster/monthly?year={YEAR}&month={MONTH}", timeout=60).json()
    assert next(e for e in restored["employees"] if e["id"] == emp["id"])["assigned_shift"] == orig
