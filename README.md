# GIO Keralam International Conference on Women: website and registration

The public website for the GIO Keralam International Conference on Women (15 November 2026, Ernakulam), with registration, an admin console for the website content, and the registration workflow below.

People register through a public form. The registration is confirmed automatically and its entry pass, with a signed QR code, is generated at once and shown on the success page, where the registrant can download or share it. Admins list and search the registrations; they do not confirm them. Every file (website images, registrants' photos and entry pass images) is stored in DigitalOcean Spaces and served from its CDN.

This is a standalone application with its own database, configuration and admin accounts. It shares no data, credentials or code with any other project.

## Contents

- [Stack and structure](#stack-and-structure)
- [Local setup](#local-setup)
- [Configuration (`server/.env`)](#configuration-serverenv)
- [Admin sign-in](#admin-sign-in)
- [Conference website](#conference-website)
- [Registration form](#registration-form)
- [File storage (DigitalOcean Spaces)](#file-storage-digitalocean-spaces)
- [Registration workflow](#registration-workflow)
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
| Files | DigitalOcean Spaces (`@aws-sdk/client-s3`) and the Spaces CDN, isolated behind one adapter |
| Phone numbers | `libphonenumber-js` mobile metadata, the same version on client and server |

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
    │   ├── config/constants.js   # statuses, roles, form version, children defaults
    │   ├── models/               # Registration, Admin, EntryPass, Asset, Counter, ...
    │   ├── providers/assetStore.js # the only file that talks to DigitalOcean Spaces
    │   ├── utils/phone.js        # mobile number rules per country
    │   ├── services/
    │   │   ├── registrations.js  # submission (pass issued at once), admin "generate pass"
    │   │   ├── passes.js         # issue / store in Spaces / links / verify passes
    │   │   ├── passRenderer.js   # PNG design
    │   │   ├── validation.js     # server-side input validation
    │   │   └── auth.js
    │   ├── middleware/auth.js    # session, permissions, CSRF header check
    │   └── routes/               # public, auth, admin, website, passes (signed download link)
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

## Configuration (`server/.env`)

All configuration lives on the server. The client contains no secrets.

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | yes | This app's own database |
| `JWT_SECRET` | yes | Signs admin sessions. Use 32+ random characters. |
| `PASS_SIGNING_SECRET` | yes | Signs QR codes and pass download links. Use 32+ random characters, different from `JWT_SECRET`. Rotating it invalidates every issued QR code. |
| `DO_SPACES_KEY`, `DO_SPACES_SECRET` | yes | Spaces access key. See [File storage](#file-storage-digitalocean-spaces). |
| `DO_SPACES_ENDPOINT`, `DO_SPACES_REGION` | yes | For example `https://blr1.digitaloceanspaces.com` and `blr1` |
| `DO_SPACES_BUCKET` | yes | The Space (bucket) name |
| `DO_SPACES_CDN_URL` | yes | CDN address of the Space, for example `https://BUCKET.blr1.cdn.digitaloceanspaces.com`. Files are served from here. |
| `DO_SPACES_FOLDER` | | Prefix inside the bucket, for example `GIO` |
| `EVENT_NAME`, `EVENT_DATE`, `EVENT_VENUE` | | Shown on the form and on the pass until the website settings are published |
| `SUPPORT_CONTACT` | | Optional help line shown on the form |
| `REGISTRATION_OPEN` | | `false` closes the public form whatever the admin switch says |
| `DEFAULT_COUNTRY_CODE` | | Default `91` (India). Calling code of the country preselected for the phone and WhatsApp numbers. |
| `DISTRICTS` | | Optional comma-separated district list. Defaults to the 14 districts of Kerala, with Malappuram split into Malappuram West and Malappuram East. |
| `TRUST_PROXY` | | `1` behind one reverse proxy, so rate limits see real client IPs |
| `SESSION_HOURS` | | Admin session length (default 12) |
| `PASS_IMAGE_LINK_MINUTES` | | Lifetime of the pass download link on the success page (default 60) |
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

The admin can do everything: list and search registrations, view and download passes, generate a pass for a registration that has none, verify passes, and edit and publish the website.

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

**Event details on passes.** The published title, date, location and venue are also printed on entry passes (`services/site.js`, `getEvent()`). Until the first publish, `EVENT_NAME`, `EVENT_DATE` and `EVENT_VENUE` are used. The pass image is drawn once, when the pass is issued, and keeps those details. The publish dialog says how many passes have already been issued.

**Registration open.** The form is open only when `REGISTRATION_OPEN` is not `false` **and** the admin switch is on.

**First set-up.** `npm run seed-site` shows what it would create. `npm run seed-site -- --apply` creates the draft from the approved details and imports the logo and poster; add `--publish` to publish it as well. It never changes settings that already exist.

## Registration form

Fields marked with a red star are required; Area and Unit are optional.

| Field | Rule |
|---|---|
| Name, Age, District, Email | Required |
| Photo | Required. Uploaded as soon as it is chosen (`POST /api/public/photos`): the form resizes it to at most 1200 px and sends a JPEG; the server checks it like website images (JPEG or PNG from the bytes, at least 200 px, EXIF and GPS removed), stores a JPEG of at most 900 px in Spaces and returns its key, which the submission carries. The server refuses a submission whose photo is not in Spaces. Printed on the entry pass and shown in the admin console. |
| Place | Required (`PLACE_REQUIRED` in `config/constants.js`) |
| Area, Unit | Optional. When given, the same character rule as Place. Stored empty when left blank. |
| Phone number | Required. A country picker (default from `DEFAULT_COUNTRY_CODE`, India) and the national number in digits. The allowed lengths and number ranges are those of the chosen country, from libphonenumber's mobile metadata (`utils/phone.js` on the server, `lib/phone.ts` in the form; both use the same package version). India: 10 digits. Part of the duplicate rule. |
| WhatsApp number | "Same as phone number" is ticked by default. Otherwise its own country picker and number, checked the same way. **Not** part of the duplicate rule. |
| Gender | Asked only when an admin has entered the options (Page content, Registration). |
| Accompanying children | Always asked. The registrant enters the number of children, then a name and age for each. Limits: the admin-set maximum and age range (Page content, Registration), or by default up to 10 children aged 0 to 17 (`CHILDREN_DEFAULTS`). |

The note "Any accompanying adults must register separately." is always shown.

**Form versions.** The form sends `formVersion: 3`. A submission without `formVersion` comes from the original form and is still accepted with the original fields. Version 2 and any other version are refused with "Please reload the page".

**Children on the pass.** The pass prints an "Accompanying children: N" band and says "Valid for the holder and N accompanying children". Names and ages are never printed; admins see them on the registration page.

**Older registrations** have no gender, place, WhatsApp number or children (or children without names); the admin console shows "Not recorded". Nothing is back-filled.

## File storage (DigitalOcean Spaces)

`providers/assetStore.js` is the only code that talks to Spaces. Every file is uploaded public-read under `DO_SPACES_FOLDER` and served from `DO_SPACES_CDN_URL`:

| What | Object key |
|---|---|
| Website images | `<folder>/assets/<sha256>.<jpg or png>` |
| Entry pass images | `<folder>/passes/<passId>-v<version>-<random 32 hex>.png` |
| Registrants' photos | `<folder>/photos/<random 32 hex>.jpg` |

Every name changes whenever the content changes, so files are cached for a year (`Cache-Control: public, max-age=31536000, immutable`). Pass image and photo names carry a random token, so they cannot be guessed. The Content Security Policy allows images from the CDN origin.

The CDN sends no CORS headers, so the browser cannot read a CDN file as data. "Download" and "Share" on the success page therefore use a signed, expiring link on this server (`/api/passes/:passId/image`), which reads the same file from Spaces.

Upload checks (`services/assets.js`): admins only. JPEG or PNG, decided from the file's bytes; SVG, GIF, WebP and anything else are refused (WebP because the installed `canvas` cannot decode it). At most 5 MB and at least 200 px on each side. Dimensions are read from the header, and anything over 40 megapixels is refused before decoding. Every image is redrawn and re-encoded, which removes EXIF data such as the GPS position and applies the EXIF rotation; the long side is reduced to 1600 px. Alternative text is required.

Replacing an image keeps the library entry, so every place that uses it shows the new file; the old file is removed from Spaces unless another entry uses it. An image that is used anywhere, in a draft or in the published copy, cannot be deleted. `npm run assets-cleanup` lists website image files in Spaces without a library entry, and photos uploaded more than a day ago whose form was never submitted (`-- --apply` deletes them).

## Registration workflow

```
Public form ──▶ Confirmed automatically ──▶ Entry pass generated and stored ──▶ Shown on the success page
```

There is no WhatsApp integration and no admin confirmation. `POST /api/public/registrations` saves the registration with status `confirmed` and a `REG-00001`-style number, issues the entry pass, draws the PNG, stores it in Spaces and returns the pass with the response. The success page shows the pass with **Download pass** and **Share pass** (the system share sheet with the image where the browser supports it, otherwise the link, otherwise the link is copied).

**If the pass cannot be stored** (for example Spaces is unreachable), the registration is kept and the registrant sees "Your registration REG-… is saved, but your entry pass could not be created just now. Please press Submit again." Submit sends the same `Idempotency-Key`, so the same registration is returned and its pass is tried again. A registration left without a pass appears on the dashboard under **Without entry pass**, where an admin can press **Generate entry pass**.

**Admins** list, search and filter registrations (Entry pass issued / No pass yet, district, area, unit, dates), and view or download each pass.

**Older registrations.** Status `submitted` only remains on registrations made before this change. **Generate entry pass** confirms such a registration and issues its pass. Pass statuses `sent` and `send_failed` from the WhatsApp era both count as issued. A pass issued before images were kept in Spaces gets its image stored the first time it is viewed.

**History.** Every change appends `{from, to, by, byName, note, at}` to `statusHistory`, and the detail page shows it as a timeline.

**Duplicate protection.**

| Situation | Protection |
|---|---|
| Double tap or network retry on the form | `Idempotency-Key` header with a unique index on `submissionKey`. The original registration and its pass are returned and nothing new is saved. |
| The same person registering twice | Unique index on (normalised mobile, normalised name). Returns `409`. |
| Two passes for one registration | Unique index on `EntryPass.registration`, plus a unique `passId` with retry on collision. The image key is saved only if none is saved yet. |

## Entry passes

- **Format.** A PNG, 1080 px wide (taller when it prints the photo, Place and the children band). It shows the event, the attendee's photo and name, registration number, district, area, unit, place, the number of accompanying children, a QR code and the pass ID.
- **Pass ID.** 12 random characters such as `K7QM-X2PA-9TZD`, from an alphabet without look-alike characters. It has a unique index and is regenerated if it ever collides.
- **QR content.** `<passId>.<version>.<HMAC signature>`. Changing any character makes the code invalid.
- **Where the registrant gets it.** On the success page, straight after submitting: the image from the CDN, Download (a same-origin, signed link that expires after `PASS_IMAGE_LINK_MINUTES`) and Share.
- **Where admins see it.** `/api/admin/registrations/:id/pass.png` (signed-in session) redirects to the image on the CDN; `?download=1` sends it as a download. The registration page has View and Download buttons.
- **Checking a pass.** `POST /api/admin/passes/verify {code}` (signed-in admin) checks the signature, version, revocation and registration status. There is no scanner screen yet.

## Security

- Admin routes require a session cookie: httpOnly, `SameSite=Strict`, and `Secure` in production. Each request reloads the admin record, so logging out or changing the credentials in `.env` takes effect immediately. Logout revokes the session on the server.
- Permissions are checked on the server for every action, per role.
- State-changing admin requests must carry an `X-Requested-With: rms` header. This is a CSRF check on top of SameSite.
- The admin password is read from `.env` as plain text and compared in constant time. After 5 failed sign-ins the account is locked for 15 minutes. Login timing does not reveal whether the username was right.
- Rate limits are 30 submissions per hour per IP and 20 login attempts per 15 minutes per IP (production values).
- Every input is validated on the server with zod. Unknown fields are rejected, and a hidden honeypot field catches bots. Search terms are regex-escaped, and sort and filter values come from fixed lists.
- The public API returns only the registration number, name and the registrant's own pass (CDN address and a signed download link). It exposes no list or lookup endpoint.
- Helmet sets security headers, including a Content Security Policy that allows images only from this origin and the Spaces CDN. The JSON body limit is 20 KB.
- Secrets live only in `server/.env`, which git ignores. The client bundle contains none.

## Deployment

Before deploying this version to an environment that already has registrations:

1. Take a `mongodump` of that database and test a restore into a separate database. Record the counts by status and pass status. Keep a copy of the `.env`, including `PASS_SIGNING_SECRET`.
2. Run `npm run check-indexes` against it (read-only). It must report "No existing index would be dropped".
3. Set the `DO_SPACES_*` variables (see [File storage](#file-storage-digitalocean-spaces)). Website images that were stored in GridFS by an earlier version must be uploaded again in the admin console.
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
4. Production `.env`: set `NODE_ENV=production`, `TRUST_PROXY=1`, the `DO_SPACES_*` variables and fresh secrets.
5. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the production `.env`.
6. **`canvas` system packages.** On Linux, `canvas` needs Cairo and Pango, and the pass needs fonts. On Debian or Ubuntu: `apt install libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 fonts-noto-core`. Add `fonts-noto-ui-indic` or similar if names may be written in Indic scripts. Prebuilt binaries cover Windows and macOS.
7. Make sure the reverse proxy accepts request bodies up to 5 MB on `/api/admin/website/assets` (image uploads).

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
| `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_ENDPOINT`, `DO_SPACES_REGION`, `DO_SPACES_BUCKET`, `DO_SPACES_CDN_URL`, `DO_SPACES_FOLDER` | The Space that holds every file. Required (the server refuses to start without them). |
| `MONGODB_URI` | The Atlas connection string from step 1 |
| `TRUST_PROXY` | `1`, then check it (step 6) |
| `PORT` | The component's HTTP port |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | The admin sign-in (password at least 10 characters) |
| `JWT_SECRET`, `PASS_SIGNING_SECRET` | Two different values from `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. If you restore an existing database, keep its `PASS_SIGNING_SECRET`, or every issued QR code stops working. |

The other variables are optional (see [Configuration](#configuration-serverenv)). Keep a copy of the secrets outside DigitalOcean.

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

**7. Check the pass.** Register yourself (try a name in Malayalam). The success page should show the pass; check that the text on it looks right and that Download and Share work on your phone.

**Deploys.** Every push to the deployed branch builds and deploys. The new instance takes traffic once `/api/health` answers, which happens after the database connects. The old instance then gets `SIGTERM` and finishes its open requests before it exits.

**Backups.** Use the backups of your Atlas tier, and also run `mongodump --uri "<MONGODB_URI>"` before the event and before any deploy that changes data. Files (images and passes) are in Spaces, not in the dump.

## Tests

```bash
npm test
```

The tests run against an in-memory MongoDB and an in-memory stand-in for Spaces (`test/helpers.js` replaces the S3 client's `send`), so they need no setup and never touch the network or the real bucket.

| Area | Covered |
|---|---|
| Submission (`workflow.test.js`) | Confirmed at once with its pass; the PNG is stored under `passes/` and returned as a CDN address; the download link returns the PNG as an attachment; tampered, expired and unsigned links get 404; idempotent resubmission; duplicate person; registration closed; Spaces down gives 503 `pass_failed` and the same key retries without a second registration |
| Form (`registration.test.js`) | Version 3 rules: required fields, optional Area and Unit, phone numbers per country (India 10 digits, UAE 9, Qatar 8, unknown country), WhatsApp in another country, children names and ages with default and admin limits, gender rules, version 2 refused, the original form still accepted |
| Auth | 401 without a session, account lockout, only the `.env` admin can sign in, credential change signs out sessions, cookie flags, CSRF header, logout revocation |
| Admin | Detail with children, pass redirect to the CDN and download, generate pass, verify, stats, filters, search, every filter and sort, pagination |
| Older records (`legacy-records.test.js`) | Registrations and passes inserted as the earlier code wrote them: "not recorded" fields, `sent` counting as issued, generate pass confirms a `submitted` record, the image of an old pass stored once on first view, stored documents not rewritten by reading |
| Website and images (`content.test.js`) | Drafts, preview, publish, version conflicts, form rules; image type from the bytes, size limits, EXIF and GPS removed, rotation, CDN addresses, files in Spaces with public-read and cache headers, replace and delete remove the old file, failed upload saves nothing |

## API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/public/config` | none | Event name, date, venue; whether registration is open; district list; default country; form version, gender options and children limits |
| GET | `/api/public/site` | none | Published website content (404 until the first publish). Image URLs point at the Spaces CDN. |
| POST | `/api/public/photos` | none | The registrant's photo as the raw body (JPEG or PNG). Returns `{photo, url, width, height}`; 60 uploads per hour per IP in production. |
| POST | `/api/public/registrations` | none | Submit `formVersion: 3, name, age, email, district, place, photo (key from /photos), area?, unit?, gender?, mobileCountry (ISO, e.g. IN), mobile (digits), whatsappSameAsMobile, whatsappCountry, whatsapp?, childrenCount, children: [{name, age}]` (optional `Idempotency-Key` header). Returns `{regNo, name, pass: {passId, imageUrl, downloadUrl}}`. |
| GET | `/api/passes/:passId/image?v&exp&sig[&download=1]` | signed link | The registrant's pass PNG, read from Spaces |
| POST | `/api/auth/login` · `/logout` · GET `/me` | | Session |
| GET | `/api/admin/registrations` | view | `search, pass(issued,missing), district, area, unit, from, to, sort(createdAt,name,age,district), dir, page, limit≤100` |
| GET | `/api/admin/registrations/:id` | view | Details (children's names and ages), pass, history, your permissions |
| GET | `/api/admin/registrations/:id/pass.png` | view | Redirects to the pass on the CDN; `?download=1` sends it as a download |
| POST | `/api/admin/registrations/:id/pass/generate` | send | Generate the pass of a registration without one (confirms an older `submitted` one first) |
| GET | `/api/admin/stats` · `/api/admin/filters` | view | `{total, passesIssued, withoutPass, children}`; filter options (district list, areas and units from submitted data) |
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

