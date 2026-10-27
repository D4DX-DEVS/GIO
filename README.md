# GIO Keralam International Conference on Women: website and registration

The public website for the GIO Keralam International Conference on Women (15 November 2026, Ernakulam), with registration, an admin console for the website content, and the registration workflow below.

People register through a public form. Each registration is saved as Submitted. An admin confirms it with one action, which generates an entry pass with a signed QR code and sends it on WhatsApp through DXing.

This is a standalone application with its own database, configuration and admin accounts. It shares no data, credentials or code with any other project.

## Contents

- [Stack and structure](#stack-and-structure)
- [Local setup](#local-setup)
- [Configuration (`server/.env`)](#configuration-serverenv)
- [Admin sign-in](#admin-sign-in)
- [Conference website](#conference-website)
- [Registration form](#registration-form)
- [Image storage](#image-storage)
- [Registration workflow](#registration-workflow)
- [DXing WhatsApp integration](#dxing-whatsapp-integration)
- [Entry passes](#entry-passes)
- [Security](#security)
- [Deployment](#deployment)
  - [Deploying to DigitalOcean App Platform](#deploying-to-digitalocean-app-platform)
- [Tests](#tests)
- [API reference](#api-reference)

## Stack and structure

| Layer | Technology |
|---|---|
| Client | React 18, TypeScript, Vite 5, Tailwind CSS 3, React Router 6 |
| Server | Node.js 20+, Express 4, Mongoose 8 (MongoDB), zod validation |
| Auth | Admin username and password from `.env`, JWT in an httpOnly SameSite=Strict cookie, server-side revocation |
| Entry pass | `canvas` (PNG rendering) and `qrcode` |
| WhatsApp | DXing HTTP API, isolated behind one adapter |

In production, one Node process serves both the API and the built client, so the browser only ever talks to one origin.

```
gio/
├── package.json              # convenience scripts for both packages
├── client/                   # React app
│   ├── vite.config.ts        # dev proxy /api -> :5100
│   └── src/
│       ├── pages/Landing.tsx                  # conference website (/)
│       ├── pages/Register.tsx                 # public form (/register)
│       ├── pages/admin/website/               # Website: page content, lists, images
│       ├── pages/admin/Login.tsx              # /admin/login
│       ├── pages/admin/Dashboard.tsx          # /admin list, search, sort, filters
│       ├── pages/admin/RegistrationDetail.tsx # /admin/registrations/:id
│       ├── components/ui.tsx                  # buttons, fields, badges, dialog, toasts
│       └── lib/                               # api wrapper, auth context, types, labels
└── server/
    ├── .env.example
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
cp server/.env.example server/.env   # then edit, including ADMIN_USERNAME / ADMIN_PASSWORD
```

For a local database, `npm run db` starts MongoDB at the host and port in `MONGODB_URI` (for example `mongodb://127.0.0.1:27018/registration_system`), with its data in `server/.data/db`. Keep that terminal open; the server cannot start without it.

To develop with hot reload, run the database, the API and the client in three terminals:

```bash
npm run db             # local MongoDB (skip if you use another database)
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
| `/` | Conference landing page with Register Now |
| `/register` | Public registration form (`/registration` redirects here) |
| `/?preview=1` | Landing page with drafts, for signed-in admins |
| `/admin/login` | Admin sign in. There is no public sign-up page. |
| `/admin` | Dashboard |
| `/admin/website` | Website: page content, programme, speakers, announcements, FAQs, gallery, images (admins only) |

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
| `EVENT_NAME`, `EVENT_DATE`, `EVENT_VENUE` | | Shown on the form, in messages and on the pass until the website settings are published |
| `SUPPORT_CONTACT` | | Optional help line added to messages and to the form |
| `REGISTRATION_OPEN` | | `false` closes the public form whatever the admin switch says |
| `ASSET_STORAGE` | yes in production | `gridfs` or `local`; where website images are stored. See [Image storage](#image-storage). |
| `ASSET_STORAGE_DIR` | | Folder for `ASSET_STORAGE=local` (default `server/.data/assets`) |
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

## Admin sign-in

There is one admin account, set in `server/.env`:

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=a-password-of-at-least-10-characters
```

The server refuses to start without them. The password is stored and compared as plain text, so keep `.env` private. Database accounts cannot sign in. To change the credentials, edit `.env` and restart the server; every existing session is signed out.

The admin can do everything: confirm registrations, generate, send or resend passes, retry messages, verify passes, and edit and publish the website.

## Conference website

`/` is the landing page (Design C, Minimal). It is built from the published website content (`GET /api/public/site`). If that request fails, or nothing has been published yet, it shows the approved details (title, theme, date, location, and the logo and poster in `client/public/brand/`), and Register Now still works.

**Editing.** Admins edit the website under **Website** in the admin console:

| Page | What |
|---|---|
| Page content | Title, introduction, date, location, venue, theme, About, contact, section headings, which sections are shown, the registration-open switch and the registration form rules |
| Programme, Speakers, Announcements, FAQs, Gallery | Lists. New items are drafts; Publish shows them, Unpublish hides them, Delete removes them. Programme items follow their start time; the others follow the order set with the arrows. |
| Images | Upload, edit alternative text and caption, replace, delete |

**Drafts and publishing.** Everything has a draft (what admins edit) and a published copy (what visitors see). Save keeps a draft; Publish copies it to the website. **Preview** (`/?preview=1`) shows every draft and hidden section, outlined. Every save carries a version number, so if two admins edit at once the second save is refused with "changed by another admin" instead of overwriting. The last five published versions of the page are kept in `sitesettings.previous`.

While no programme item is published, the website shows "Programme will be announced soon."

**Event details in messages and passes.** The published title, date, location and venue are also used in WhatsApp messages and on entry pass images (`services/site.js`, `getEvent()`). Until the first publish, `EVENT_NAME`, `EVENT_DATE` and `EVENT_VENUE` are used. Holder details on a pass are frozen when it is issued. The publish dialog says how many passes have already been issued.

**Registration open.** The form is open only when `REGISTRATION_OPEN` is not `false` **and** the admin switch is on.

**First set-up.** `npm run seed-site` shows what it would create. `npm run seed-site -- --apply` creates the draft from the approved details and imports the logo and poster; add `--publish` to publish it as well. It never changes settings that already exist.

## Registration form

| Field | Rule |
|---|---|
| Name, Age, District, Area, Unit, Email | Unchanged |
| Phone number | Unchanged (stored as `mobile`); part of the duplicate rule |
| Place | New, separate from Area and Unit, same character rule. Required (`PLACE_REQUIRED` in `config/constants.js`). |
| WhatsApp number | New. "Same as phone number" is ticked by default. Validated like the phone number, with the same country code. **Not** part of the duplicate rule. |
| Gender | Asked only when an admin has entered the options (Page content, Registration). Until then it is not shown and not accepted. |
| Accompanying children | Asked only when an admin has set the maximum number and the youngest and oldest age. The form then asks for the number and one age per child. |

The note "Any accompanying adults must register separately." is always shown.

**Form versions.** The new form sends `formVersion: 2`. A submission without `formVersion` comes from the original form (for example a page opened before a deploy) and is still accepted, with the original fields only. Any other version is refused with "Please reload the page".

**WhatsApp recipient.** Messages and the pass go to the WhatsApp number when the registration has one, otherwise to the mobile number, as for every registration made before this change (`recipientOf` in `services/notifications.js`). Each message record stores the number used.

**Children on the pass.** The confirmation message and the pass caption add "Accompanying children: N" when N is more than 0. New passes print Place and an "Accompanying children: N" band, and say "Valid for the holder and N accompanying children". Ages are never printed; admins see them on the registration page, staff see only the number. Passes issued before this change print exactly as before.

**Older registrations** have no gender, place, WhatsApp number or children; the admin console shows "Not recorded". Nothing is back-filled.

## Image storage

`providers/assetStore.js` is the only code that knows where image files are. `ASSET_STORAGE` chooses:

| Value | Where | Use when |
|---|---|---|
| `gridfs` | GridFS bucket `siteassets` in this app's MongoDB | The disk is not persistent (containers, most platforms) and the database has room. One `mongodump` backs up registrations and images together. |
| `local` | Files in `ASSET_STORAGE_DIR` (default `server/.data/assets`) | A server with a persistent, backed-up disk and one app process |

Development defaults to `gridfs`. **Production must set it explicitly**; the server refuses to start otherwise. Choose it once the hosting and the database quota are confirmed. Object storage (for example S3 or R2) would be a third implementation of the same `put`, `get` and `remove` functions, plus a CSP `img-src` entry.

Upload checks (`services/assets.js`): admins only. JPEG or PNG, decided from the file's bytes; SVG, GIF, WebP and anything else are refused (WebP because the installed `canvas` cannot decode it). At most 5 MB and at least 200 px on each side. Dimensions are read from the header, and anything over 40 megapixels is refused before decoding. Every image is redrawn and re-encoded, which removes EXIF data such as the GPS position and applies the EXIF rotation; the long side is reduced to 1600 px. Alternative text is required.

Files are stored under their SHA-256 and served from `/api/assets/<sha256>.<ext>` with a one-year immutable cache. Replacing an image keeps the library entry, so every place that uses it shows the new file; the old file is removed unless another entry uses the same file. An image that is used anywhere, in a draft or in the published copy, cannot be deleted. `npm run assets-cleanup` lists stored files without a library entry.

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
- **Checking a pass.** `POST /api/admin/passes/verify {code}` (signed-in admin) checks the signature, version, revocation and registration status. There is no scanner screen yet; see the open items at the end.

## Security

- Admin routes require a session cookie: httpOnly, `SameSite=Strict`, and `Secure` in production. Each request reloads the admin record, so logging out or changing the credentials in `.env` takes effect immediately. Logout revokes the session on the server.
- Permissions are checked on the server for every action, per role.
- State-changing admin requests must carry an `X-Requested-With: rms` header. This is a CSRF check on top of SameSite.
- The admin password is read from `.env` as plain text and compared in constant time. After 5 failed sign-ins the account is locked for 15 minutes. Login timing does not reveal whether the username was right.
- Rate limits are 30 submissions per hour per IP and 20 login attempts per 15 minutes per IP (production values).
- Every input is validated on the server with zod. Unknown fields are rejected, and a hidden honeypot field catches bots. Search terms are regex-escaped, and sort and filter values come from fixed lists.
- The public API returns only the registration number and name. It exposes no list or lookup endpoint.
- Helmet sets security headers, including a Content Security Policy. The JSON body limit is 20 KB.
- Secrets live only in `server/.env`, which git ignores. The client bundle contains none.

## Deployment

Before deploying this version to an environment that already has registrations:

1. Take a `mongodump` of that database and test a restore into a separate database. Record the counts by status and pass status. Keep a copy of the `.env`, including `PASS_SIGNING_SECRET`.
2. Run `npm run check-indexes` against it (read-only). It must report "No existing index would be dropped". This release adds collections (`sitesettings`, `contentitems`, `assets`, and `siteassets.files` / `siteassets.chunks` with GridFS) and changes no existing index or document.
3. Set `ASSET_STORAGE` (see [Image storage](#image-storage)).
4. Deploy. Run `npm run seed-site` (dry run), then `npm run seed-site -- --apply`, review in the admin console, and publish.
5. To roll back, redeploy the previous build. It ignores the new fields and collections.

General set-up:

1. Run Node.js 20+ on a host behind HTTPS, using nginx, Caddy, or a platform load balancer.
2. Use a MongoDB database created for this application only.
3. Build and start:
   ```bash
   npm run install:all
   npm run build
   NODE_ENV=production npm start      # or run it under pm2 / systemd
   ```
4. Production `.env`: set `NODE_ENV=production`, `PUBLIC_BASE_URL=https://your-domain`, `TRUST_PROXY=1` and fresh secrets.
5. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the production `.env`.
6. **`canvas` system packages.** On Linux, `canvas` needs Cairo and Pango, and the pass needs fonts. On Debian or Ubuntu: `apt install libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 fonts-noto-core`. Add `fonts-noto-ui-indic` or similar if names may be written in Indic scripts. Prebuilt binaries cover Windows and macOS.
7. Make sure the reverse proxy forwards `/api/passes/*` publicly, because DXing must reach it, and accepts request bodies up to 5 MB on `/api/admin/website/assets` (image uploads).

### Deploying to DigitalOcean App Platform

App Platform builds this repository with its Node.js buildpack. Do not add a `Dockerfile` to the root: App Platform would switch to a Docker build.

**How the build works.** The buildpack installs only the root `package.json`, which has no dependencies. Its `heroku-prebuild` script therefore installs `server/` (production dependencies only) and `client/` (including TypeScript and Vite, even when `NODE_ENV=production`). The buildpack then runs `npm run build`, which builds `client/dist`, and starts the app with `npm start`. `engines.node` in the root `package.json` pins Node.js 22.

The entry pass needs Cairo, Pango and fonts. The buildpack's Ubuntu 22.04 image includes Cairo, Pango and Latin fonts, but no Malayalam font, so Noto Sans Malayalam is kept in `server/fonts/` and registered by `services/passRenderer.js`.

**1. MongoDB Atlas.**

- Create the cluster in AWS Mumbai (`ap-south-1`), the region closest to App Platform's Bangalore. The free M0 tier has no backups, so use a paid tier once real registrations come in.
- Database Access: create a user with `readWrite` on `registration_system` only.
- Network Access: App Platform has no fixed outbound IP by default. Either allow `0.0.0.0/0` (access still needs the database user's password, over TLS), or add a dedicated egress IP to the app and allow only that address.
- Connection string: put the database name in the path, or the data goes to a database called `test`. URL-encode special characters in the password.
  ```
  mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/registration_system?retryWrites=true&w=majority
  ```

**2. Component settings** (App > Settings > the web component):

| Setting | Value |
|---|---|
| Source | `D4DX-DEVS/GIO`, the branch you deploy (`production`), autodeploy on |
| Build command | Empty (the buildpack runs `npm run build`) |
| Run command | `npm start` |
| HTTP port | The same number as the `PORT` variable |
| Health check | HTTP, path `/api/health` |
| Instances | 1. The rate limits are kept in memory, per instance. |

**3. Environment variables.** Set the secrets as encrypted, with scope Run time; the build does not need them.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production`. With `development`, cookies are sent without `Secure` and the rate limits are 30 times looser. |
| `ASSET_STORAGE` | `gridfs`. Required in production (the server refuses to start without it). App Platform has no persistent disk. |
| `MONGODB_URI` | The Atlas connection string from step 1 |
| `PUBLIC_BASE_URL` | `${APP_URL}` (follows the primary domain), or `https://your-domain` |
| `TRUST_PROXY` | `1`, then check it (step 6) |
| `PORT` | The component's HTTP port |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | The admin sign-in (password at least 10 characters) |
| `JWT_SECRET`, `PASS_SIGNING_SECRET` | Two different values from `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. If you restore an existing database, keep its `PASS_SIGNING_SECRET`, or every issued QR code stops working. |
| `DXING_MODE` | `live` |
| `DXING_API_KEY`, `DXING_INSTANCE_ID` | From DXing |

The other variables are optional (see [Configuration](#configuration-serverenv)). Keep a copy of the secrets outside DigitalOcean.

Do not use `DXING_MODE=mock` while real people are registering. Mock marks every message as sent without sending it, and the acknowledgement is never sent again later.

**4. First set-up.** In App > Console:

```bash
cd server
npm run seed-site                 # dry run
npm run seed-site -- --apply      # create the website draft, import the logo and poster
```

Review the draft under Website in the admin console, then publish it.

**5. Domain.** Add the conference domain under Settings > Domains and create the DNS records App Platform shows.

**6. Check rate limiting.** The limits count requests per client IP. If the app saw App Platform's proxy address instead, every visitor would share one limit, and registration would stop after 30 submissions an hour. Run this twice from your computer:

```bash
curl -s -D - -o /dev/null -X POST https://YOUR-DOMAIN/api/auth/login \
  -H 'X-Requested-With: rms' -H 'Content-Type: application/json' -d '{}' | grep -i '^ratelimit:'
```

`remaining` should go 19, then 18. Then run it once from another network, such as a phone hotspot. It should show 19 again. If it shows 17, set `TRUST_PROXY=2` and check again. This request cannot lock the admin account, because it sends no username.

**7. Check WhatsApp and the pass.** Register with your own WhatsApp number (try a name in Malayalam), then confirm the registration in `/admin`. Check that the acknowledgement, the confirmation and the pass image arrive, and that the text on the pass looks right.

**Deploys.** Every push to the deployed branch builds and deploys. The new instance takes traffic once `/api/health` answers, which happens after the database connects. The old instance then gets `SIGTERM` and finishes its open requests before it exits.

**Backups.** Use the backups of your Atlas tier, and also run `mongodump --uri "<MONGODB_URI>"` before the event and before any deploy that changes data. Images are stored in the same database (GridFS), so the dump includes them.

## Tests

```bash
npm test
```

The tests run against an in-memory MongoDB and need no setup. They use a local fake DXing server to cover payloads, failures and retries.

| Area | Covered |
|---|---|
| Public form | Name: letters and spaces only. Mobile: digits only, correct length and leading digit, country code from the list. Age, email, district from the list. Unknown fields and honeypot, Submitted status, acknowledgement text says "not confirmed", idempotent resubmission, duplicate person, registration closed |
| Auth | 401 without a session, account lockout, only the `.env` admin can sign in, credential change signs out sessions, cookie flags, CSRF header, logout revocation |
| Workflow | Only Submitted and Confirmed exist. A concurrent double Confirm produces one transition, one pass and one set of messages. Confirm sends a text and the pass image. A second Confirm is refused. |
| Passes | Signed link works; tampered, expired and unsigned links get 404. Admin-only image route. Generate refused when a pass exists. Resend cooldown. QR verify rejects forgeries. |
| DXing | Payload shape. Rejected response, HTTP 503 and unreachable host are all recorded, not thrown. Pass kept on failure. Retry. A second retry is refused. |
| Listing | Search by name, mobile and email. Regex characters treated literally. Every filter, every sort, pagination, filter options, stats. |
| Website (`content.test.js`) | 401 for signed-out users, CSRF header, validation (safe links, form rules), drafts not public, preview, publish, discard, version conflicts, hidden-section text not sent, registration switch, event details reaching messages and passes, programme, speakers and FAQs (publish, unpublish, order, delete), persistence across a restart |
| Images (`content.test.js`) | Type from the bytes (SVG, GIF and text sent as an image refused), size limits, a header claiming a huge image, EXIF and GPS removed, rotation, replace, in-use delete refused, delete, both storage backends |
| Form version 2 (`registration-v2.test.js`) | Place, WhatsApp (same, different, invalid), gender and children with and without admin rules, duplicate rule unchanged, idempotency, recipient of the acknowledgement, confirmation, pass and retry, children on messages and pass (never ages), pass size, gate check, ages for admins only, search |
| Older records (`legacy-records.test.js`) | Registrations and passes inserted exactly as the original code wrote them: "not recorded" fields, filters, original pass size, gate check, resend and confirm to the mobile number, original message wording, stored documents not rewritten |

A browser check was also run in headless Chrome at 390 px and 1366 px wide. It covered the form, invalid names and mobile numbers, the district suggestions, login, search and filters, Confirm Registration → pass, sorting, logout, and checked that no page overflows horizontally.

## API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/public/config` | none | Event name, date, venue; whether registration is open; district list; country codes; form version, gender options and children limits |
| GET | `/api/public/site` | none | Published website content (404 until the first publish) |
| GET | `/api/assets/:sha256.:ext` | none | Website image |
| POST | `/api/public/registrations` | none | Submit `name, age, mobile (digits only), countryCode (optional, default DEFAULT_COUNTRY_CODE), email, district, area, unit`; form version 2 adds `formVersion: 2, place, whatsappSameAsMobile, whatsapp, gender, childrenCount, childAges` (optional `Idempotency-Key` header) |
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
| GET, PUT | `/api/admin/website/settings` | content | Page settings (draft, published, version); save the draft with `{draft, version}` |
| POST | `/api/admin/website/settings/publish`, `/discard` | content | `{version}` |
| GET | `/api/admin/website/preview` | content | The website with every draft |
| GET, POST | `/api/admin/website/items/:kind` | content | `kind` is programme, speaker, announcement, faq or gallery. Create with `{data}` |
| PUT, DELETE | `/api/admin/website/items/:kind/:id` | content | Update with `{data, version}`; delete |
| POST | `/api/admin/website/items/:kind/:id/publish`, `/unpublish`, `/move` | content | `{version}`; move with `{direction: "up" or "down"}` |
| GET, POST | `/api/admin/website/assets` | content | Library; upload (the image as the raw body, `?alt=&caption=`, `X-File-Name`) |
| PUT, DELETE | `/api/admin/website/assets/:id` | content | Alternative text and caption; delete (409 while in use) |
| POST | `/api/admin/website/assets/:id/replace` | content | New file for the same image |

Action endpoints return the updated registration plus `messages: [{ok, error, template}]`, so the admin panel can show exactly which WhatsApp message failed and why.
