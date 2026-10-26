# Registration Management System

This is a mobile-first registration app. People register through a public form. Each registration is saved as Submitted. An admin confirms it with one action, which generates an entry pass with a signed QR code and sends it on WhatsApp through DXing.

This is a standalone application with its own database, configuration and admin accounts. It shares no data, credentials or code with any other project.

## Contents

- [Stack and structure](#stack-and-structure)
- [Local setup](#local-setup)
- [Configuration (`server/.env`)](#configuration-serverenv)
- [Creating admin accounts](#creating-admin-accounts)
- [Registration workflow](#registration-workflow)
- [DXing WhatsApp integration](#dxing-whatsapp-integration)
- [Entry passes](#entry-passes)
- [Security](#security)
- [Deployment](#deployment)
- [Tests](#tests)
- [API reference](#api-reference)

## Stack and structure

| Layer | Technology |
|---|---|
| Client | React 18, TypeScript, Vite 5, Tailwind CSS 3, React Router 6 |
| Server | Node.js 20+, Express 4, Mongoose 8 (MongoDB), zod validation |
| Auth | bcrypt password hashes, JWT in an httpOnly SameSite=Strict cookie, server-side revocation |
| Entry pass | `canvas` (PNG rendering) and `qrcode` |
| WhatsApp | DXing HTTP API, isolated behind one adapter |

In production, one Node process serves both the API and the built client, so the browser only ever talks to one origin.

```
gio/
├── package.json              # convenience scripts for both packages
├── client/                   # React app
│   ├── vite.config.ts        # dev proxy /api -> :5100
│   └── src/
│       ├── pages/Register.tsx                 # public form (/)
│       ├── pages/admin/Login.tsx              # /admin/login
│       ├── pages/admin/Dashboard.tsx          # /admin list, search, sort, filters
│       ├── pages/admin/RegistrationDetail.tsx # /admin/registrations/:id
│       ├── components/ui.tsx                  # buttons, fields, badges, dialog, toasts
│       └── lib/                               # api wrapper, auth context, types, labels
└── server/
    ├── .env.example
    ├── scripts/create-admin.js   # create the first admin or reset a password
    ├── src/
    │   ├── app.js / server.js
    │   ├── config/env.js         # every setting, read from the environment
    │   ├── config/constants.js   # statuses, allowed transitions, roles, templates
    │   ├── models/               # Registration, Admin, EntryPass, Notification, Counter
    │   ├── providers/dxing.js    # the only file that talks to DXing
    │   ├── services/
    │   │   ├── registrations.js  # submission + status transitions (business rules)
    │   │   ├── notifications.js  # message log, de-duplication, retry
    │   │   ├── templates.js      # WhatsApp wording (edit messages here)
    │   │   ├── passes.js         # issue / render / verify passes
    │   │   ├── passRenderer.js   # PNG design
    │   │   ├── validation.js     # server-side input validation
    │   │   └── auth.js
    │   ├── middleware/auth.js    # session, permissions, CSRF header check
    │   └── routes/               # public, auth, admin, passes (signed image link)
    └── test/                     # integration tests (in-memory MongoDB)
```

## Local setup

You need Node.js 20 or later, and a MongoDB database created for this app only. That can be a local `mongod`, Docker (`docker run -p 27017:27017 mongo:7`) or a MongoDB Atlas cluster.

```bash
npm run install:all                  # installs server and client dependencies
cp server/.env.example server/.env   # then edit; see the next section
npm run create-admin -- --username yourname --name "Your Name" --role admin
```

To develop with hot reload, run the API and the client in two terminals:

```bash
npm run dev:server     # API on http://localhost:5100
npm run dev:client     # UI on http://localhost:5173 (proxies /api to :5100)
```

To run it the way production does:

```bash
npm run build          # builds client/dist
npm start              # http://localhost:5100 serves the form, /admin and the API
```

| URL | What |
|---|---|
| `/` | Public registration form |
| `/admin/login` | Admin sign in. There is no public sign-up page. |
| `/admin` | Dashboard |

`DXING_MODE` defaults to `mock`. In mock mode every message is recorded in the database and shown in the admin panel, but nothing goes to WhatsApp.

## Configuration (`server/.env`)

All configuration lives on the server. The client contains no secrets.

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | yes | This app's own database |
| `JWT_SECRET` | yes | Signs admin sessions. Use 32+ random characters. |
| `PASS_SIGNING_SECRET` | yes | Signs QR codes and pass-image links. Use 32+ random characters, different from `JWT_SECRET`. Rotating it invalidates every issued QR code. |
| `PUBLIC_BASE_URL` | yes when live | Public HTTPS origin of this server. DXing downloads pass images from it. |
| `DXING_MODE` | | `mock` (default) or `live` |
| `DXING_API_KEY` | when live | DXing secret. Sent in the request body as `secret`. |
| `DXING_INSTANCE_ID` | when live | DXing WhatsApp account/instance. Sent as `account`. |
| `DXING_BASE_URL` | | Default `https://app.dxing.in/api` |
| `DXING_TIMEOUT_MS` | | Default 30000 |
| `EVENT_NAME`, `EVENT_DATE`, `EVENT_VENUE` | | Shown on the form, in messages and on the pass |
| `SUPPORT_CONTACT` | | Optional help line added to messages and to the form |
| `REGISTRATION_OPEN` | | `false` closes the public form |
| `DEFAULT_COUNTRY_CODE` | | Default `91`. The form asks for the national number only (digits); this code is added before it is saved and sent to DXing. |
| `DISTRICTS` | | Optional comma-separated district list. Defaults to the 14 districts of Kerala. |
| `TRUST_PROXY` | | `1` behind one reverse proxy, so rate limits see real client IPs |
| `SESSION_HOURS` | | Admin session length (default 12) |
| `PASS_IMAGE_LINK_MINUTES` | | Lifetime of the signed image link sent to DXing (default 60) |
| `CORS_ORIGINS` | | Only if the client is hosted on another origin |
| `PORT`, `NODE_ENV` | | `NODE_ENV=production` enables secure cookies and stricter rate limits |

To generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Creating admin accounts

```bash
npm run create-admin -- --username alice --name "Alice" --role admin
```

The script asks for the password and hides what you type. It never takes the password as a command-line argument. For scripted setups, put it in the `RMS_ADMIN_PASSWORD` environment variable instead. Passwords must be at least 10 characters.

If you run the command again for an existing username, it resets that account's password and role and signs the account out everywhere.

| Role | Can do |
|---|---|
| `admin` | Everything: confirm registrations, generate, send or resend passes, retry messages |
| `staff` | View registrations and verify passes. Cannot confirm registrations or send passes. |

## Registration workflow

```
Submitted ──Confirm Registration──▶ Confirmed ──▶ Entry pass generated ──▶ Entry pass sent
```

There are only two registration statuses, `submitted` and `confirmed`. The server enforces the one allowed transition (listed in `server/src/config/constants.js`); anything else returns `409`.

| Step | Trigger | What happens | WhatsApp |
|---|---|---|---|
| Submitted | Public form | Saved with status `submitted` and a `REG-00001`-style number. Shown on the dashboard as awaiting confirmation. | "We have received your registration… not confirmed yet" |
| Confirmed | Admin: **Confirm Registration** (with a confirmation dialog) | Status saved first, then the entry pass is generated | "…is confirmed" text |
| Entry pass generated | Automatically after confirmation | One pass per registration, with a unique pass ID and signed QR code | |
| Entry pass sent | Automatically after generation | Pass status becomes `sent` when DXing accepts it | The pass image |

**Status and pass are tracked separately.** Each registration has a `status` and also a `passStatus`: `not_generated`, `generated`, `sent` or `send_failed`. If WhatsApp fails, the confirmation and the generated pass are kept, the pass status becomes `send_failed`, and the dashboard shows a **Retry sending pass** button.

**History.** Every change appends `{from, to, by, byName, note, at}` to `statusHistory`, and the detail page shows it as a timeline.

**Duplicate protection.**

| Situation | Protection |
|---|---|
| Double tap or network retry on the form | `Idempotency-Key` header with a unique index on `submissionKey`. The original registration is returned and nothing new is saved or sent. |
| The same person registering twice | Unique index on (normalised mobile, normalised name). Returns `409`. |
| Two admins, or a double click, on the same action | The current status is part of the update filter, so only one request wins. The other gets `409`. |
| The same message sent twice | Each message has a unique `dedupeKey` in `notifications`. A repeated key never sends. |
| Two passes for one registration | Unique index on `EntryPass.registration`, plus a unique `passId` with retry on collision |
| Resend spam | "Resend pass" refuses within 60 seconds of the last send |

## DXing WhatsApp integration

`server/src/providers/dxing.js` is the only code that calls DXing. The adapter sends:

```
POST {DXING_BASE_URL}/send/whatsapp
Content-Type: application/json

text:  { secret, account, recipient, type: "text",  message }
image: { secret, account, recipient, type: "media", message: <caption>,
         media_url: <signed pass link>, media_type: "image" }
```

- `recipient` is the international number without `+`, for example `919876543210`.
- A request counts as successful only when the HTTP status is 2xx **and** the response body contains `status: 200`.
- Failures are saved on the message record (`lastError`, `attempts`) and shown to the admin with a **Retry** button.
- Log lines include the reason for a failure but never the request body, so the API key is never logged.

**Please check this against your DXing account documentation.** These payload fields and the success check come from a known-working DXing integration, but they have **not been tested with your credentials**. If your account uses different field names, only `providers/dxing.js` needs to change.

**Accepted is not delivered.** A message marked "Accepted by DXing" means DXing accepted the request. The app never claims a message was delivered, because there is no delivery-receipt webhook.

### Turning on live sending

1. In `server/.env`, set `DXING_MODE=live`, `DXING_API_KEY` and `DXING_INSTANCE_ID`.
2. Set `PUBLIC_BASE_URL` to an HTTPS address DXing can reach. On a laptop, use a tunnel such as `cloudflared tunnel --url http://localhost:5100` or `ngrok http 5100`. Without it, text messages work but the pass image cannot be fetched.
3. Restart the server. It refuses to start in live mode if any of these values are missing.
4. Register with your own WhatsApp number. You should receive the acknowledgement.
5. In `/admin`, press **Confirm Registration** for it. You should receive the confirmation and the pass image.
6. If a message fails, the registration page shows DXing's error text. Fix the setting, then press **Retry**.

To change the wording, edit `server/src/services/templates.js`.

## Entry passes

- **Format.** A 1080×1660 PNG. WhatsApp shows images inline, so attendees see the pass without opening a document. It shows the event, the attendee's name, registration number, district, area, unit, a QR code and the pass ID.
- **Pass ID.** 12 random characters such as `K7QM-X2PA-9TZD`, from an alphabet without look-alike characters. It has a unique index and is regenerated if it ever collides.
- **QR content.** `<passId>.<version>.<HMAC signature>`. Changing any character makes the code invalid.
- **Where admins see it.** The registration page shows the pass from `/api/admin/registrations/:id/pass.png`, which requires a signed-in session. It has View and Download buttons.
- **The link DXing gets.** `/api/passes/:passId/image?v=&exp=&sig=` is signed and expires (60 minutes by default). Every failure returns the same `404`, and images are served with `Cache-Control: private, no-store`. The pass is never stored at a permanent public URL.
- **Checking a pass.** `POST /api/admin/passes/verify {code}` (roles `admin` and `staff`) checks the signature, version, revocation and registration status. There is no scanner screen yet; see the open items at the end.

## Security

- Admin routes require a session cookie: httpOnly, `SameSite=Strict`, and `Secure` in production. Each request reloads the admin record, so deactivating an account, changing its role or logging out takes effect immediately. Logout revokes the session on the server.
- Permissions are checked on the server for every action, per role.
- State-changing admin requests must carry an `X-Requested-With: rms` header. This is a CSRF check on top of SameSite.
- Passwords are hashed with bcrypt (12 rounds). After 5 failed sign-ins an account is locked for 15 minutes. Login timing does not reveal which usernames exist.
- Rate limits are 30 submissions per hour per IP and 20 login attempts per 15 minutes per IP (production values).
- Every input is validated on the server with zod. Unknown fields are rejected, and a hidden honeypot field catches bots. Search terms are regex-escaped, and sort and filter values come from fixed lists.
- The public API returns only the registration number and name. It exposes no list or lookup endpoint.
- Helmet sets security headers, including a Content Security Policy. The JSON body limit is 20 KB.
- Secrets live only in `server/.env`, which git ignores. The client bundle contains none.

## Deployment

1. Run Node.js 20+ on a host behind HTTPS, using nginx, Caddy, or a platform load balancer.
2. Use a MongoDB database created for this application only.
3. Build and start:
   ```bash
   npm run install:all
   npm run build
   NODE_ENV=production npm start      # or run it under pm2 / systemd
   ```
4. Production `.env`: set `NODE_ENV=production`, `PUBLIC_BASE_URL=https://your-domain`, `TRUST_PROXY=1` and fresh secrets.
5. Create the first admin with `npm run create-admin -- ...` on the server.
6. **`canvas` system packages.** On Linux, `canvas` needs Cairo and Pango, and the pass needs fonts. On Debian or Ubuntu: `apt install libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 fonts-noto-core`. Add `fonts-noto-ui-indic` or similar if names may be written in Indic scripts. Prebuilt binaries cover Windows and macOS.
7. Make sure the reverse proxy forwards `/api/passes/*` publicly, because DXing must reach it.

## Tests

```bash
npm test
```

The tests run against an in-memory MongoDB and need no setup. They use a local fake DXing server to cover payloads, failures and retries.

| Area | Covered |
|---|---|
| Public form | Name: letters and spaces only. Mobile: digits only, correct length and leading digit, country code from the list. Age, email, district from the list. Unknown fields and honeypot, Submitted status, acknowledgement text says "not confirmed", idempotent resubmission, duplicate person, registration closed |
| Auth | 401 without a session, account lockout, cookie flags, CSRF header, logout revocation |
| Workflow | Only Submitted and Confirmed exist. Staff cannot confirm. A concurrent double Confirm produces one transition, one pass and one set of messages. Confirm sends a text and the pass image. A second Confirm is refused. |
| Passes | Signed link works; tampered, expired and unsigned links get 404. Admin-only image route. Generate refused when a pass exists. Resend cooldown. QR verify rejects forgeries. |
| DXing | Payload shape. Rejected response, HTTP 503 and unreachable host are all recorded, not thrown. Pass kept on failure. Retry. A second retry is refused. |
| Listing | Search by name, mobile and email. Regex characters treated literally. Every filter, every sort, pagination, filter options, stats. |

A browser check was also run in headless Chrome at 390 px and 1366 px wide. It covered the form, invalid names and mobile numbers, the district suggestions, login, search and filters, Confirm Registration → pass, sorting, logout, and checked that no page overflows horizontally.

## API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/public/config` | none | Event name, date, venue; whether registration is open; district list; country codes |
| POST | `/api/public/registrations` | none | Submit `name, age, mobile (digits only), countryCode (optional, default DEFAULT_COUNTRY_CODE), email, district, area, unit` (optional `Idempotency-Key` header) |
| GET | `/api/passes/:passId/image?v&exp&sig` | signed link | Pass PNG for DXing |
| POST | `/api/auth/login` · `/logout` · GET `/me` | | Session |
| GET | `/api/admin/registrations` | view | `search, status, passStatus, district, area, unit, from, to, sort(createdAt,name,age,district,status), dir, page, limit≤100` |
| GET | `/api/admin/registrations/:id` | view | Details, pass, messages, history, your permissions |
| GET | `/api/admin/registrations/:id/pass.png` | view | Pass image |
| POST | `/api/admin/registrations/:id/actions/confirm` | approve | Submitted → Confirmed, then pass and messages |
| POST | `/api/admin/registrations/:id/pass/generate` | send | Recovery when pass generation failed |
| POST | `/api/admin/registrations/:id/pass/resend` | send | Resend the pass (60 s cooldown) |
| POST | `/api/admin/registrations/:id/notifications/:nid/retry` | send | Retry a failed message |
| GET | `/api/admin/stats` · `/api/admin/filters` | view | Counts; filter options (district list, areas and units from submitted data) |
| POST | `/api/admin/passes/verify` | gate | Check a scanned QR code or a typed pass ID |

Action endpoints return the updated registration plus `messages: [{ok, error, template}]`, so the admin panel can show exactly which WhatsApp message failed and why.
