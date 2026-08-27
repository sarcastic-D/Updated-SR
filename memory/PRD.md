# SOC Shift Roster - PRD

## Original Problem Statement
Deploy the Shift-Roster application as-is.
Subsequent: Fix monthly roster always producing the same schedule, and add a 3-role auth system (user / manager / admin) with role-scoped capabilities, plus SOC level (L1/L2/L3) on employees.

## Architecture
- Backend: FastAPI + Motor (async MongoDB) + JWT (HS256) + bcrypt
- Frontend: React 19 + CRA (craco) + Tailwind + Radix UI + Sonner
- DB: MongoDB (collections: users, employees, roster, leave_requests, monthly_assignments)

## Roles & Capabilities
| Capability                            | user | manager | admin |
| ------------------------------------- | :--: | :-----: | :---: |
| View Monthly Roster                   | ✓    | ✓       | ✓     |
| Apply Leave (own employee only)       | ✓    | ✓       | ✓     |
| View Approvals queue                  |      | ✓       | ✓     |
| Approve / Reject leave                |      | ✓       | ✓     |
| Weekly Editor                         |      | ✓       | ✓     |
| Manage employees (CRUD)               |      | ✓       | ✓     |
| Reshuffle monthly roster              |      | ✓       | ✓     |
| Set SOC Level (L1 / L2 / L3)          |      |         | ✓     |
| Create user (any role) & assign role  |      |         | ✓     |
| Create user with role=user            |      | ✓       | ✓     |

## Features Implemented (Jan 2026)
- 3-role login (admin/manager/user) with role-aware navigation & route guards
- Admin-only Users page: create / edit / delete, assign role, link to employee
- SOC Level (L1/L2/L3) field on employees — admin-only edit, visible everywhere
- Per-month roster reshuffle with `monthly_assignments` snapshot collection
- Default badge vs "Custom Shuffle" badge with Revert action on Monthly Roster
- Leave Portal auto-locks to linked employee for role=user (backend also enforces)
- Backend permission decorator `require_roles(...)` on every protected endpoint
- 23 SOC/SecOps employees seeded with default SOC levels
- **Per-shift summary cards** (M/A/N) on Monthly Roster: Staff, Man-days, Min/Day coverage, Leaves
- **Daily Coverage footer row** inside each shift section (red below 50% headcount)
- **Leave Calendar page** (`/leave-calendar`, manager+admin): month grid with employee×day cells colored by status (P/A/R), 4 stat cards, status filter, daily-total footer, backend `?year=&month=` filter

## Features Added (Jul 2026 — this session)
- **L3 Sat/Sun rule enforced everywhere**: startup backfill migrates existing L3 employees to Sat/Sun off; `create_user_with_employee` and `update_employee` force `weekoff_days = ["Saturday","Sunday"]` and demote Night → Morning for any L3 employee
- **Drag-and-drop between shifts** on Monthly Roster (admin/manager only): each employee row is draggable, each shift section is a drop target; drop triggers `POST /api/roster/monthly/assign` which creates/updates a per-month snapshot without touching untouched employees; L3 Night drops are blocked with a toast
- **Excel Import Shifts** dialog on Monthly Roster (admin/manager only): parses xlsx/xls/csv with columns S.No, Resource Name, Level, Leave Dates, Existing Shift, Recomm Shift, Remarks; matches rows to employees by emp_id / name / first-name; preview → Apply flow calls `POST /api/roster/monthly/import`; shows matched + unmatched result tables; only affected employees are changed
- **Excel Import Analysts** dialog on Employees page (admin/manager only): parses xlsx/xls/csv with columns Analyst Name/Name, Emp ID (opt), Email (opt), Level (L1/L2/L3), SecOps (Yes/No); auto-assigns next sequential Emp ID if blank, generates slugified email placeholder if blank, balances default shift + weekoff, L3 rule enforced; preview → Apply flow calls `POST /api/employees/import`; shows created + skipped result tables
- **Create Credentials for Employees** dialog on Users page (admin only): auto-lists all employees without a linked user account (matched by email + linked_emp_id); per-row checkbox + role selector + auto-generated typeable password (Word@NNNN format) with regen button; bulk actions — Default role apply-to-all, Regenerate all passwords, Show/Hide passwords, Copy list (TSV) before or after creation; sequentially calls existing `POST /api/users` with `linked_emp_id` per row, shows created + failed summary
- **New endpoints**: `POST /api/roster/monthly/assign` (manual per-employee patch), `POST /api/roster/monthly/import` (bulk from parsed leave-tracker sheet), `POST /api/employees/import` (bulk create analysts)

## Status
- Backend tests: 27/27 passing for current features (iteration_5.json)
- Frontend role flows + new features: 100% verified
- Code review fixes applied (Jan 2026): hardcoded secret → env var, undefined-var false positive guarded, AuthContext empty catch → logged, index-as-key → stable keys, UsersPage `load` wrapped in `useCallback`, MonthlyRosterPage/LeaveCalendarPage already-stable callbacks unchanged
- Deployment readiness: PASS

## Admin Credentials
- Email: admin@roster.app  ·  Password: Admin@2026

## Next Actions / Backlog
- P2: split `server.py` into per-resource routers (~960 lines)
- P2: migrate `/app/backend/tests/test_roster_api.py` to authenticated fixtures (stale failures, pre-existing)
- P2: push leave-date overlap filter into Mongo query for scale (currently Python-side)
- P3: email notifications (SendGrid/Resend) for leave approval/rejection

## Deployment Import (Aug 2026 — as-is deploy)
- Imported `sarcastic-D/Shift_roster` main (commit 8bf4b3b) into /app. No source/logic changes.
- Env set: backend JWT_SECRET (required, >=32 chars), CORS_ORIGINS (frontend origin + localhost), ADMIN_EMAIL/ADMIN_PASSWORD; Mongo via MONGO_URL/DB_NAME (Emergent managed). Frontend REACT_APP_BACKEND_URL unchanged.
- Verified: backend /api responds, admin login works, Mongo read/write OK, frontend production build (`yarn build`) succeeds → deployable as-is.
- Known (non-blocking) note: repo ships no lockfile; fresh install resolves webpack-dev-server@5.2.4 which breaks the in-workspace dev preview (`craco start`) via react-scripts 5.0.1's onAfterSetupMiddleware. Does NOT affect the deployed static build. Left unchanged per user instruction.

## Preview Fix (Aug 2026)
- Committed resolutions pinned webpack-dev-server to 5.2.4, breaking react-scripts 5.0.1 dev server. Changed that single resolution to 4.15.2 (config-only, no app source). Live preview now boots and UI login verified end-to-end. Production build unaffected.
