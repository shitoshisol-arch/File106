# FILE106 — THE ARCHIVE

Architecture and integration report. Stages 1–2 delivered.

Status: Stage 2. Nothing is deployed, nothing touches mainnet, and no treasury
key exists anywhere in this repository.

---

## 1. What exists today

| Area | Current state | Consequence for the Archive |
|---|---|---|
| `site/index.html` | 364-line static trust page: hero, on-chain proof, admin-power matrix, market, status, FAQ, channels | Content is **kept**; becomes the HOME page. Its claims are accurate and link to real transactions. |
| `site/styles.css` | 1041 lines, token-based design system (`--bg #080a0c`, `--amber #ffc857`, `--mono`) | **Kept as the base stylesheet.** The archive aesthetic is an extension, not a rewrite. |
| `site/app.js` | 42 lines, copy-to-clipboard only | Migrated unchanged; the only client JS that survives. |
| `site/favicon.svg` | Brand mark | Kept. |
| `.github/workflows/pages.yml` | Uploads `site/` to GitHub Pages on push | **Retired at cutover.** Pages cannot run server code, hold session secrets, or gate access. |
| `scripts/*.ts` | Solana token tooling: mint creation, metadata, revoke, trust report | **Untouched.** These are operational tools, not part of the web app. |
| `keys/`, `output/`, `.env` | Keypairs and local state, git-ignored | **Untouched.** The web app never reads `keys/`. |
| Dependencies | `@solana/web3.js`, spl-token, Metaplex, tsx | Reused for server-side RPC and transaction verification. |
| Backend | None. No server, no API, no database, no accounts | Everything in spec §3–§14 is new. |

The trust page's claim — "No analytics, no trackers, no wallet connection" — was
true of that page and would have become misleading once the Archive gained a
wallet gate. Stage 2 reworded it to describe the page itself ("This page carries
no analytics, no trackers, and never asks you to connect a wallet"), which stays
accurate: the signature flow lives on `/dashboard` and still asks for no
transaction approval. A cookie/session notice is owed before the Archive
replaces this page.

## 2. Target architecture

Chosen: **custom Node server on a VPS** (your Stage-1 decision). One box, three
containers, no vendor lock-in, no serverless cold starts, and full control over
rate limiting and audit logging.

```
                    Internet
                       |
              :80/:443 |  Caddy (auto-HTTPS, HSTS, body limits)
                       v
                +--------------+
                |  app (Node)  |  Fastify: SSR pages + JSON API
                |  :3000       |
                +--------------+
                  |         |
        node:pg   |         |  HTTPS (server-side only)
                  v         v
          +-----------+  +-----------------+
          | Postgres  |  | Solana RPC      |
          | 16        |  | (Helius/public) |
          +-----------+  +-----------------+
            127.0.0.1 only
```

Why not serverless: submission review, rate limiting, and audit logging all want
a long-lived process and a real transaction boundary. Why not a framework
(Next/React): the existing site is hand-written HTML/CSS and performs well; adding
a build step buys nothing here and complicates CSP nonces.

Runtime choices:

- **Fastify** with `@fastify/session`, `@fastify/cookie`, `@fastify/helmet`,
  `@fastify/rate-limit`, `@fastify/formbody`, `@fastify/static`. CSRF is a
  hand-written guard rather than `@fastify/csrf-protection`, because the token is
  rendered into server-side forms and compared in constant time on one hook that
  every mutating request passes through.
- **Server-rendered HTML** with small ES modules. No hydration, no client state
  store. Wallet connection uses `window.solana` / wallet-standard directly.
- **Postgres 16** with hand-written SQL migrations (already in `db/`). No ORM in
  the data path; typed query helpers instead. Migrations stay reviewable.
- **scrypt** for password and answer hashing via `node:crypto` — no native build
  step, so the same code runs on Windows and in the container. `scrypt$N$r$p$...`
  is self-describing, so an argon2id upgrade is a rehash-on-login migration.
- **AES-256-GCM** for submitted answers at rest, keyed by `ANSWER_ENC_KEY`.

## 3. URL map

The spec (§15) lists HOME and THE ARCHIVE as separate destinations, so the trust
page survives intact:

| Path | Content | Auth |
|---|---|---|
| `/` | HOME — the existing trust page, plus an entry point into the archive | public |
| `/archive` | File list: open, locked, closed, completed | public |
| `/archive/file-106` | Individual file; briefing, reward, status, submit form | public view, account+wallet+holding to submit |
| `/partnerships` | Active partnership campaigns | public |
| `/partnerships/transmission-108` | Campaign page with the 17-step status list | public |
| `/winners` | THE ARCHIVE RECORDS — confirmed rewards with tx links | public |
| `/how-it-works` | Rules, eligibility, deadlines, reward limitations | public |
| `/register`, `/login`, `/verify` | Account creation and verification | public |
| `/dashboard` | MY ARCHIVE: files, submissions, rewards, missions, settings | participant |
| `/admin/*` | OVERVIEW, FILE MANAGER, SUBMISSIONS, WINNERS, REWARDS, PARTNERSHIPS, ANALYTICS, USERS, SETTINGS, AUDIT | admin role |

Server-rendered pages, no client-side router, so a locked file is locked on the
server and the "ACCESS RESTRICTED" screen is never a CSS trick.

## 4. Data model

20 tables in `db/migrations/0001_init.sql`, covering every entity in spec §14:

| Spec entity | Table | Notes |
|---|---|---|
| Users | `users` | lowercase-enforced username/email, status lifecycle |
| UserWallets | `user_wallets` | unique address globally = anti-sybil spine; one primary per user |
| — | `verification_tokens` | email verify, password reset |
| — | `auth_nonces` | single-use wallet signature challenges |
| — | `sessions` | only a SHA-256 of the cookie is stored |
| — | `settings` | admin-editable reward/holding defaults and feature flags |
| Files | `files` | number, slug, status, difficulty, reward, min holding, window, winner method |
| FileAttachments | `file_attachments` | private storage keys, never public URLs |
| Challenges | `challenges` | `answer_hash` only; frozen once contested |
| Submissions | `submissions` | ciphertext + HMAC digest, holding snapshot, attempt history |
| Winners | `winners` | one wallet can win a file once |
| Rewards | `rewards` | money fields immutable after approval |
| Transactions | `transactions` | append-only payment evidence |
| Partnerships | `partnerships` | partner profile |
| PartnershipCampaigns | `partnership_campaigns` | status incl. `paused`, keeps reward history |
| CampaignTasks | `campaign_tasks` | `verification_mode` auto/manual |
| SocialVerifications | `social_verifications` | can only be `verified` with a check timestamp |
| UserCampaignProgress | `user_campaign_progress` | denormalised 17-step journey state |
| AdminUsers | `admin_users` | roles: owner, admin, reviewer |
| AdminAuditLogs | `admin_audit_logs` | append-only |

Three read views are included so the public and admin pages never reconstruct
trust-sensitive aggregates in the browser: `v_public_winners`, `v_file_stats`,
`v_campaign_stats`. The public view exposes no email, no admin id, no internal
notes, and no reward that is not `approved`.

## 5. Security model

**Answers never leave the server.** `challenges.answer_hash` is not selected by
any public query; the submit handler compares inside the request and returns only
a status. A guard trigger refuses to change an answer hash once a submission
exists, so an admin cannot quietly re-key a puzzle a participant already solved.

**Submitted answers are encrypted.** `answer_ciphertext` is AES-256-GCM with a
server key; `answer_digest` is an HMAC used for duplicate detection without
decryption. A stolen database dump yields neither puzzle keys nor participant
answers. `ANSWER_ENC_KEY` loss renders pending submissions unreadable — that
trade is deliberate and must be backed up with the database.

**Wallets are proven, not claimed.** Linking a wallet issues a single-use nonce,
asks the wallet to sign a domain-separated message, verifies the signature against
the address, then marks the nonce consumed. The address is then stored globally
unique, so a second account cannot reuse it.

**Balance is checked server-side.** Every gate (`ARCHIVE_RPC_URL`, mint
`F106_MINT_ADDRESS`, decimals 8) calls `getTokenAccountsByOwner`, sums the
owner's token accounts for that mint, and stores `holding_snapshot_f106` plus
`balance_slot` on the submission. A browser-supplied balance is never read.

**No automatic payments.** No keypair, seed, or treasury secret exists in the
app, the container, or `.env`. Admin pays from their own wallet and pastes a
signature; the server then verifies:

1. the signature exists and is confirmed at the configured commitment;
2. the transaction did not fail;
3. the mint of the token balance delta is `F106_MINT_ADDRESS`;
4. the delta lands on the winner's wallet (owner match, ATA created allowed);
5. the transferred amount in base units ≥ `rewards.amount_f106 × 10^8`.

Only then is the transaction inserted as `verified` and the reward linked once.
A reward can never be re-linked or rolled back, and a transaction cannot confirm
two rewards.

**Admin surface.** Separate principal type, separate cookie, 12-hour session TTL,
role checks on every route (not just nav visibility), CSRF on every mutating
form, rate limits per IP and per account, and an append-only audit row for every
admin action with before/after state.

**Anti-farming, honestly.** Holding 1 F106 is cheap, so token gating alone is not
sybil resistance. Controls: one address per account, one submission attempt per
challenge (retries require an admin-granted attempt number), per-wallet win caps
per file, and eligibility snapshots stored per submission. Residual risk: a
determined operator with many funded wallets and many emails can still farm
small rewards. Mitigations available if it happens: raise min holding, require
wallet age, require a funded ATA before the campaign start, or cap per-IP
registrations.

## 6. Threat model

| Threat | Control | Residual |
|---|---|---|
| Answer scraped from the page or API | Answer exists only as a hash in the DB; never in HTML, JS, JSON, or logs | Admin could leak it out of band |
| Answer brute-forced | `max_attempts` per challenge, per-user attempt history, per-IP rate limit, admin review of pending answers | Cheap puzzles can still be guessed across many accounts |
| Sybil farming of rewards | unique wallet, unique (user, challenge, attempt), per-wallet win cap, eligibility snapshot | Funded multi-wallet operators |
| Fake green social check | `status='verified'` requires `checked_at`; manual review requires a reviewer id | Human reviewer error |
| Admin pastes a fake tx URL | On-chain verification of mint, recipient, amount, and success | A near-identical transfer of the wrong amount is rejected, not accepted |
| Admin account takeover | Separate principal, short TTL, scrypt hashes, rate-limited login, audit trail | Weak admin password |
| Replay of a wallet signature | Single-use nonce, expiry, consumed on use, domain-separated message | — |
| Stolen pre-login cookie promoted into a session | Session saves are compare-and-set on a generation; signing in regenerates it, so the old cookie's save is refused (`ENOENT`) | — |
| Revoking a session | Delete the `sessions` row (or set `revoked_at`); the next request finds no session and starts anonymous | — |
| Double payout of one reward | `rewards.confirmed_transaction_id` unique + one tx per reward + immutable once confirmed | Admin paying twice on-chain; the second reward record would fail to link |
| Database dump | Answers encrypted, sessions hashed, no private keys stored, no treasury material | Emails/usernames are plaintext by necessity |
| Answer change after solving | `challenges_guard` trigger | — |
| Backup exfiltration | `pg_dump` encrypted at rest, stored off-box | Your storage policy |
| CSRF on admin actions | Double-submit token bound to the session | — |

## 7. X and Telegram verification — what is real

You chose **manual admin review** for X. That is implemented as a first-class
path, not a stub:

- `campaign_tasks.verification_mode = 'manual'` for X tasks.
- UI shows **YELLOW — VERIFICATION UNAVAILABLE** for X, never a green check.
- Participant submits their @handle plus a link; admin reviews and either
  verifies or rejects, with reviewer id and timestamp recorded.
- `social_verifications.method = 'manual_review'`.

Genuine X verification needs a paid X API tier plus an OAuth 2.0 user context
with the follows scope. `X_OAUTH_ENABLED=false` gates the code path; the schema
already carries `method = 'x_oauth'` and `provider_ref`, so enabling it later
requires no migration. I will not display a green check without evidence, and
neither should the deployed site.

Telegram **can** be genuine: `getChatMember` against a bot that is an admin in
the group, with the participant's numeric id captured when they start the bot
via a deep link. That arrives in Stage 6, and requires your bot token and admin
rights in each group.

## 8. Payment flow, end to end

```
participant submits  -> submissions.status = pending_review
admin reviews        -> correct | incorrect   (+ reviewed_by, reviewed_at, admin_note)
admin approves       -> winners.status = approved  -> rewards.payment_status = awaiting_payment
admin pays from own wallet (outside the app)
admin pastes sig     -> transactions row inserted, verification_status = pending
server verifies      -> verified  -> transactions row linked to reward
reward               -> payment_status = confirmed, confirmed_at set
public               -> v_public_winners exposes username, amount, date, explorer link
```

Failure path: verification fails → the `transactions` row is stored as `failed`
with `failure_reason`, the reward stays `awaiting_payment`, and the admin sees
why. No silent success, no editing of a past claim.

## 9. Deployment topology and runbook (prepared, not run)

`docker-compose.yml`, `Dockerfile` and `deploy/Caddyfile` are in place. The stack
is four services: `db`, `migrate`, `app`, `proxy`. Ordering is enforced by
compose itself — `app` waits for `migrate` to exit successfully, and `migrate`
waits for Postgres to accept connections.

Server prerequisites:

- Ubuntu 24.04 VPS, 4 GB RAM is comfortable, 2 GB works.
- Docker Engine + Compose plugin.
- DNS A record for `SITE_DOMAIN` → VPS IP.
- Ports 22, 80, 443. Postgres stays on `127.0.0.1`.
- Nightly `pg_dump -Fc` to object storage, plus a monthly restore test.

Application of the schema — and every later migration — is a deploy step, not a
manual psql session. `migrate` applies each file in `db/migrations/` once and
records it in `schema_migrations`, so running it again is a no-op:

```bash
sudo bash scripts/archive/bootstrap-vps.sh   # host packages, swap, firewall, Docker
node scripts/archive/init-env.mjs --domain archive.example.org   # writes .env, generates secrets
node scripts/archive/preflight.mjs   # live-checks env, RPC and SMTP
docker compose up -d --build   # db -> migrate -> app -> Caddy TLS
```

A step-by-step runbook for the zero-monthly-cost deployment (Oracle Cloud
Always Free, DuckDNS, Helius, Brevo) — including the two Oracle firewalls, the
DuckDNS/SPF trade-off and the backup schedule — is in
[`docs/DEPLOY-ZERO-COST.md`](DEPLOY-ZERO-COST.md).

Local development needs no Docker and no database server: the test suites run
the real migrations, the real HTTP stack and real ed25519 signing against an
embedded Postgres engine.

```bash
npm install
npm test          # 75 checks: schema guards, auth/session, wallet, RPC reader
npm start         # serves site/ and the archive routes on :3000
```

Secrets are generated on the server, never committed:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Cutover from GitHub Pages happens at Stage 8 and is a DNS change, not a rebuild:
the trust page content moves to `/` inside the app, and `pages.yml` is deleted in
the same commit that adds the Caddy route.

## 10. Stage plan and acceptance criteria

| Stage | Deliverable | Done when |
|---|---|---|
| **1 (done)** | Architecture, schema, triggers, seed, compose, Caddy | `npm run test:db` passes — 26 checks, including every guard below |
| **2 (done)** | Auth, sessions, wallet link, balance gate, dashboard shell | `npm run test:app` passes — 49 checks; a participant registers, verifies, signs in, links a wallet with a real ed25519 signature, and the balance is read server-side |
| 3 | THE ARCHIVE: list, file page, admin file manager, private uploads | An admin creates a file with an answer; the answer appears nowhere in the HTML or API |
| 4 | Submissions, review, winners, manual payout + tx verification | Full journey on devnet: submit → approve → pay → verify → public winner |
| 5 | Partnership Control Room, campaigns, tasks, analytics, CSV | Campaign created, participant completes the 17 steps, stats agree with the DB |
| 6 | Telegram bot verification, X manual-review UX polish | A real group membership check passes and fails correctly |
| 7 | Dashboards, public records page, exports | Every number on screen traces to a query |
| 8 | Security pass, mobile pass, backups, Pages retirement | Restore drill passes, mobile usable, no Pages deploy |

## 11. Verified in each stage

`npm run test:db` executes the migration and seed against a real Postgres engine
and asserts 26 behaviours, including: duplicate wallet rejected, duplicate
submission attempt rejected, wallet cannot win a file twice, green check without
a timestamp rejected, manual verification without a reviewer rejected, reward
confirmation without a transaction rejected, reward amount immutable after
approval, reward undeletable, transactions append-only, audit log append-only,
one transaction confirms one reward, confirmed reward cannot roll back, answer
hash frozen after first submission, no plaintext answer in `submissions`, 8-decimal
amount precision, invalid wallet/email formats rejected, and pausing a campaign
preserving its reward records.

`npm run test:app` drives the real Fastify app through `inject()` against an
embedded Postgres engine and asserts 49 behaviours in three suites:

- **auth (25)** — the trust page still serves at `/`, security headers, archive
  404, anonymous redirect, registration → email → single-use verification →
  sign-in, weak password refused, duplicate email refused without echoing the
  hash, missing CSRF refused, unverified sign-in refused, generic wrong-password
  message, session id regenerated on sign-in, wallet challenge per address,
  forged signature refused and nothing written, genuine signature linked with a
  server-side balance read, challenge replay refused, second account cannot link
  the same wallet, RPC outage degrades the dashboard instead of breaking it,
  sign-out destroys the session, and a database failure that never prints driver
  text to the browser.
- **solana (14)** — message format is stable and says it moves no funds, genuine
  ed25519 signatures verify while tampered/foreign/garbage ones do not, exact
  base-unit maths at 8 decimals (no floats, thousands of digits preserved), and
  the production RPC reader sums only the configured mint through a recorded
  JSON-RPC response.
- **session (10)** — the store keys rows by digest, a stale generation is refused
  and changes nothing, a matching generation advances the session, the same
  generation cannot be replayed, a non-uuid principal never reaches the foreign
  key, expired sessions read as absent and are removed, revoked sessions are
  invisible and unwritable, destroy removes the row, and a sweep clears the rest.

## 12. Open items

| Item | Needed by | Owner |
|---|---|---|
| VPS provider, IP, SSH access | Stage 2 | you |
| `SITE_DOMAIN` + DNS control | Stage 2 | you |
| Dedicated Solana RPC URL | Stage 2 | you |
| SMTP credentials (or accept log-printed verification links) | Stage 2 | you |
| Admin email for the first owner account | Stage 2 | you |
| Telegram bot token + admin rights in groups | Stage 6 | you |
| X API tier (only if you want real follow checks) | Stage 6+ | you |
| Campaign copy, partner logos, reward amounts | Stage 5 | you |
| Terms/rules page review | Stage 7 | you + legal |

Never required: your treasury keypair, seed phrase, or any ability for this app
to move your funds.
