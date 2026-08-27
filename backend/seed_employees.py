"""
Bulk seed script -- deletes all non-admin users and employees,
then creates all employees from the provided resource list
via POST /api/users/with-employee.
"""

import requests
import re
import time
import os

BASE = os.environ.get("SEED_API_BASE", "http://localhost:8000/api")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@roster.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
if not ADMIN_PASSWORD:
    raise SystemExit(
        "ADMIN_PASSWORD env var is required. "
        "Set it before running this seed script (matches backend/.env)."
    )

EMPLOYEES = [
    ("Divyesh",                               "L1"),
    ("Subhashree Sahoo",                      "L1"),
    ("Rakhi Barot",                           "L1"),
    ("Sandhya Bhairasandram",                 "L1"),
    ("Hemalatha Kancharla",                   "L1"),
    ("Gaurav Makwana",                        "L1"),
    ("Sanskruti Jawale",                      "L1"),
    ("Akshaya Kumar B.m",                     "L1"),
    ("Rishitha Sribhashyam",                  "L1"),
    ("Boopathi Raj V",                        "L1"),
    ("Akanksha Chauhan",                      "L1"),
    ("Amala Sunil",                           "L1"),
    ("Dasari Akhilesh",                       "L1"),
    ("Soumyadeep Shit",                       "L1"),
    ("Sitish",                                "L1"),
    ("Sai Charan Burra",                      "L1"),
    ("Kashish Arora",                         "L1"),
    ("Samikshya Mohanty",                     "L1"),
    ("Shivam Mishra",                         "L1"),
    ("Biswajeet Ram",                         "L1"),
    ("Uppuluri Sai Suman",                    "L1"),
    ("Sonali",                                "L1"),
    ("Kiranmai Molangoor",                    "L2"),
    ("Kishore Thaduri",                       "L2"),
    ("Gourav Dhawan",                         "L2"),
    ("Tejashwini Nelavigi",                   "L2"),
    ("Srinivasa H",                           "L2"),
    ("Shweta P",                              "L3"),
    ("Hari Sai Krishna Sandeep Godavarthi",   "L3"),
    ("Mohd Zeeshan Arif Khan",                "L3"),
    ("Maruthi Ganesh Chenchala",              "L3"),
    ("Komal Sharma",                          "L3"),
]


def name_to_email(name):
    clean = name.lower()
    clean = re.sub(r"[^a-z0-9\s]", "", clean)
    parts = clean.split()
    return ".".join(parts) + "@company.com"


def log(msg):
    print(msg, flush=True)


def main():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})

    # 1 -- Login
    log("Logging in as admin...")
    r = s.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    r.raise_for_status()
    token = r.json().get("access_token")
    s.headers["Authorization"] = f"Bearer {token}"
    log("  [OK] Logged in")

    # 2 -- Delete all non-admin users (cascade deletes their employee too)
    log("\nFetching existing users...")
    r = s.get(f"{BASE}/users")
    r.raise_for_status()
    users = r.json()
    log(f"  Found {len(users)} user(s)")

    deleted_users = 0
    for u in users:
        if u["email"] == ADMIN_EMAIL:
            log(f"  Skipping admin: {u['email']}")
            continue
        dr = s.delete(f"{BASE}/users/{u['id']}")
        if dr.status_code == 200:
            log(f"  Deleted user: {u['email']}")
            deleted_users += 1
        else:
            log(f"  [FAIL] delete user {u['email']}: {dr.text}")
    log(f"  [OK] Deleted {deleted_users} user(s)")

    # 3 -- Delete any remaining orphaned employees
    log("\nFetching remaining employees...")
    r = s.get(f"{BASE}/employees")
    r.raise_for_status()
    emps = r.json()
    log(f"  Found {len(emps)} employee(s)")

    deleted_emps = 0
    for e in emps:
        dr = s.delete(f"{BASE}/employees/{e['id']}")
        if dr.status_code == 200:
            log(f"  Deleted employee: {e['name']} ({e['emp_id']})")
            deleted_emps += 1
        else:
            log(f"  [FAIL] delete emp {e['name']}: {dr.text}")
    log(f"  [OK] Deleted {deleted_emps} orphaned employee(s)")

    # 4 -- Create all new users + employees
    log(f"\nCreating {len(EMPLOYEES)} employees...")
    created = 0
    failed = 0

    seed_password = os.environ.get("SEED_USER_PASSWORD")
    if not seed_password:
        raise SystemExit(
            "SEED_USER_PASSWORD env var is required. "
            "Set it to the password to assign to every seeded employee."
        )

    for name, level in EMPLOYEES:
        email = name_to_email(name)
        payload = {
            "email": email,
            "password": seed_password,
            "name": name,
            "role": "user",
            "is_secops": False,
            "soc_level": level,
        }
        r = s.post(f"{BASE}/users/with-employee", json=payload)
        if r.status_code == 200:
            emp_id = r.json().get("emp_id", "?")
            log(f"  [OK] [{level}] {name} -> {emp_id}")
            created += 1
        else:
            log(f"  [FAIL] [{level}] {name}: {r.status_code} {r.text}")
            failed += 1
        time.sleep(0.05)

    log("\n" + "=" * 55)
    log(f"  Created : {created}")
    log(f"  Failed  : {failed}")
    log(f"  Total   : {len(EMPLOYEES)}")
    log("=" * 55)
    log("\nDone! Hit Reshuffle in the app to assign shifts.")


if __name__ == "__main__":
    main()
