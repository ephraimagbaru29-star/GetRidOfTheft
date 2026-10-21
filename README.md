# Phone Charging Tracking System

Full-stack web app for a phone-charging shop — built from the PDF spec.

---

## Features

| Feature | Details |
|---|---|
| Dashboard | Live counts: active jobs, partially collected, devices in shop, closed jobs |
| New Intake | Register a charging number with customer name, face photo (with consent), and one or many devices |
| Duplicate protection | A charging number cannot have two active jobs simultaneously — enforced in the database *and* the API |
| Search & Collection | Search by charging number · collect all devices at once or one by one |
| Add device to active job | Reopen an active job and append a new device with audit trail |
| Face capture | Browser camera capture with explicit consent checkbox; stored server-side (not in localStorage) |
| Audit history | Every registration, device addition, collection, and job-close is logged with staff + timestamp |
| Staff accounts | Owner can create/deactivate attendant accounts; JWT-based session (8 h default) |
| Receipt / print | Browser print view for intake receipts |

---

## Project layout

```
GEtRidOfTheft/
├── backend/
│   ├── package.json
│   ├── .env.example          ← copy to .env and fill in values
│   ├── schema.sql            ← run once to create tables
│   └── src/
│       ├── server.js         ← Express entry point
│       ├── db.js             ← pg Pool wrapper
│       ├── audit.js          ← audit log helper
│       ├── middleware/
│       │   └── auth.js       ← JWT requireAuth / requireOwner
│       └── routes/
│           ├── auth.js       ← /api/auth/*
│           ├── jobs.js       ← /api/jobs/*
│           └── face.js       ← /api/face/upload
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── app.js            ← main SPA logic
│       ├── api.js            ← fetch wrapper
│       ├── utils.js          ← formatting helpers
│       └── face.js           ← camera capture module
└── Phone_Charging_Tracking_System_Guide.pdf
```

---

## Quick Start

### 1. Database

Create a PostgreSQL database and run the schema:

```bash
createdb charging_tracker
psql -d charging_tracker -f backend/schema.sql
```

### 2. Backend

```bash
cd backend
npm install

# Create your .env from the example
cp .env.example .env
# Edit .env — set DATABASE_URL and JWT_SECRET at minimum

npm start
# or, for auto-reload during development:
npm run dev
```

The server starts on **http://localhost:3000** (or `PORT` from `.env`).

### 3. Frontend

The Express server already serves the `frontend/` folder as static files.  
Open **http://localhost:3000** in your browser.

No separate build step is needed — the frontend uses native ES modules.

> **Camera note:** `getUserMedia` requires **HTTPS** or `localhost`.  
> For LAN testing use a self-signed cert or an ngrok tunnel.

---

## Default login

| Username | Password | Role |
|---|---|---|
| `admin` | `Admin1234` | owner |

**Change the password immediately** after first login (or delete and re-create the account via the staff management API).

---

## API reference (summary)

| Method | Path | Purpose |
|---|---|---|
| POST | /api/auth/login | Sign in, get JWT |
| GET | /api/auth/me | Current user from token |
| POST | /api/auth/staff | Create staff account (owner only) |
| GET | /api/jobs/stats | Dashboard counts |
| GET | /api/jobs | List jobs (`?status=&search=`) |
| GET | /api/jobs/search/:number | Find active job by charging number |
| GET | /api/jobs/:id | Job detail + devices + audit |
| POST | /api/jobs | Create job with devices |
| PATCH | /api/jobs/:id/face | Attach face image path |
| POST | /api/jobs/:id/devices | Add device to active job |
| PATCH | /api/jobs/:id/devices/:deviceId/collect | Collect one device |
| PATCH | /api/jobs/:id/collect-all | Collect all remaining devices |
| GET | /api/jobs/:id/audit | Audit log for job |
| POST | /api/face/upload | Upload face image (multipart) |

All `/api/jobs/*` and `/api/face/*` routes require `Authorization: Bearer <token>`.

---

## Implementation stages (from the spec)

- **Stage 1 ✅** — Interface prototype: dashboard, intake, search, multi-device, per-device collection, number reuse
- **Stage 2 ✅** — Backend: auth, persistent jobs/devices, duplicate protection, timestamps, audit, backups via DB
- **Stage 3 ✅** — Camera and face: consent, capture, upload, fallback notice
- **Stage 4** — Production hardening: HTTPS, role-based staff accounts ✅, security review, data-retention policy, concurrent testing, deployment

---

## Production checklist (before going live)

- [ ] Run behind HTTPS (required for camera and security)
- [ ] Set a strong, random `JWT_SECRET` in `.env`
- [ ] Enable PostgreSQL `ssl` in `DATABASE_URL`
- [ ] Restrict `CORS_ORIGIN` to your domain
- [ ] Serve uploaded face images behind authentication (not as public static files)
- [ ] Set a face-data retention policy and implement deletion
- [ ] Enable database backups
- [ ] Test concurrent registration of the same number
- [ ] Review and test the manual fallback for failed face matching
