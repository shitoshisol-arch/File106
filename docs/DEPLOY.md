# Deploying THE FILE106 ARCHIVE on a small VPS

The stack is one Ubuntu box running four containers. **Which box** is a swappable
choice — pick a door in §1 and every step after it is identical. The other pieces
are free tiers: **DuckDNS** subdomain, **Helius** RPC, **Brevo** mail.

Nothing here touches on-chain state, and no step ever asks for a wallet secret.

---

## 1. The VPS — pick a door

§5–§7 assume Ubuntu 24.04, Docker installed, and ports 80/443 reachable from the
internet. Every door satisfies that. They differ in cost and in memory, and **1 GB
of RAM is the number that decides how the stack must be tuned**.

| Door | Monthly | RAM | Transfer | Always on |
|---|---|---|---|---|
| **1a.** AWS Lightsail Micro-1GB | **$7 list**, covered by the 3-month trial and new-account credits | 1 GB | 2 TB | yes |
| **1b.** Hetzner (or another EU VPS) | ~€4 | 4 GB | 20 TB | yes |
| **1c.** A machine you already own | €0 | yours | your uplink | only while it stays awake |

1a is the default because an AWS account is the one host account known to be open.
1b costs less each month and removes the memory question entirely. 1c needs no
account at all.

### Doors that are shut, and why

Both free-forever VM offers are closed to a personal account in this region, and
neither is a configuration mistake you can retry your way out of:

| Provider | What happens |
|---|---|
| **Oracle Cloud Always Free** | Signup refuses the payment card |
| **Google Cloud e2-micro** | A KSA billing address is routed to CNTXT, Google's exclusive reseller there, which demands a commercial registration (CR) — a registered company, not an individual. Signup stops at a "Continue to be redirected to CNTXT" page |

Google's own FAQ is explicit: "All customers with a billing address in KSA must
have a contract with CNTXT or an authorized Google Cloud reseller in the KSA."
The always-free allowance attaches to *direct* Google billing, so it is
unreachable through a reseller contract even if you do hold a CR.

Do **not** route around either gate with a VPN and a false address. The card, the
address and the traffic are cross-checked, and a suspended billing account takes
the site down with it.

### 1a. AWS Lightsail Micro-1GB — the door that actually opens

Lightsail is the plain way onto AWS: a fixed monthly bundle instead of a
pay-per-resource puzzle. Micro-1GB is **1 GB RAM, 2 vCPUs, 40 GB SSD, 2 TB of
transfer and a public IPv4 included**. The first three months are free, then
$7/month.

1. Create the AWS account. A new account also arrives with credits on the 6-month
   Free plan, so the first months are covered twice over. Open **Billing →
   Credits** once, so you know which clock is running and when it stops.
2. Lightsail → **Create instance**:
   - Platform **Linux/Unix**, blueprint **OS only → Ubuntu 24.04 LTS**.
   - Plan **Micro-1GB ($7)**. The $5 plan is 512 MB and is too small for
     Postgres plus Node — do not save those two dollars.
   - Region nearest your users; Frankfurt, London or Singapore are the ones
     that matter here.
   - Keep the generated SSH key (Lightsail downloads a `.pem`), or upload your own.
3. **Attach a static IP** to the instance. Free while attached, and it stops a
   stop/start from moving the address out from under your DNS record.
4. **Networking** tab → add **HTTP (80)** and **HTTPS (443)** rules from anywhere.
   That is the provider firewall; `bootstrap-vps.sh` opens the host one. Caddy
   cannot obtain a certificate until both layers are open.
5. Note the static IP, then continue to §2.

**Egress is not a concern here.** This is the reason to prefer Lightsail over the
free Google tier: 2 TB of bundled transfer against Google's free gigabyte, which
would have forced an edge cache and a watchful eye on the bill. The archive at
launch will not come close.

**Memory is pre-tuned, do not undo it.** `bootstrap-vps.sh` adds 2 GB of swap, and
`docker-compose.yml` pins Postgres to `shared_buffers=128MB`,
`max_connections=30` and a small `work_mem`, holding the whole stack near 700 MB.
Those settings exist because Postgres sizes itself against the host's memory and,
left at defaults on a 1 GB box, it is the first process the OOM killer picks.

**Put a note in the calendar for the day the trial ends.** Three free months and
the credits both expire; after that this is ~$7/month charged to the card. Better
to see it coming than to find it on a statement.

### 1b. A cheaper European VPS

**Hetzner CX22** is ~€4/month for 2 vCPUs and 4 GB — the least expensive box that
runs this without thinking about memory at all, in Germany, Finland or Singapore.
Same Ubuntu 24.04 image, same `bootstrap-vps.sh`, same compose file; the memory
settings above become harmless rather than necessary. Open 80/443 in Hetzner's
cloud firewall as well as on the host.

Worth choosing over 1a only if you already hold the account or want the extra RAM
— $7 against €4 is not a reason to open a second signup.

### 1c. A machine you already own (no card at all)

When no provider will take a card, this is the only path that still runs the real
stack — and it needs no account and no payment method anywhere.

- **If your ISP gives you a real public IPv4 and allows inbound 80/443:** point
  DuckDNS at it, forward both ports on your router, and Caddy obtains a normal
  certificate exactly as §2 describes.
- **If you are behind carrier-grade NAT** (common on fibre and mobile links),
  inbound ports are not available. Use **Tailscale Funnel** — free, no card, and
  it gives you a real `https://…ts.net` address with valid TLS and no domain of
  your own. A Cloudflare named tunnel also works, but that one expects you to own
  a domain.

Be clear about what this is: uptime is your machine. A reboot, a power cut or an
update is an outage, your upload link carries every request, and a rewards
platform that dies in the middle of a submission window is worse than one that
has not launched. It is a good **private beta** against real testers, and a bad
place to invite strangers on the day money is at stake.

> **Oracle Cloud footnote.** If you do get an account, use `VM.Standard.A1.Flex`
> (2 OCPU / 12 GB; the quota is 4/24) with the Ubuntu 24.04 ARM image — our
> containers are multi-arch. Two firewalls must both be opened: the VCN security
> list *and* the host's own `iptables` `INPUT` chain, which Oracle's images ship
> dropping everything but SSH. "Out of host capacity" is the normal failure;
> retry, try another availability domain, or try a smaller 1/6 shape.

### Prepare the host

```bash
sudo apt update && sudo apt -y upgrade
# 2 GB swap: Postgres on a small instance without swap is a slow outage
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"     # log out and back in for this to apply
```

Optional but recommended on a public box:

```bash
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

---

## 2. The name — DuckDNS

1. Sign in at duckdns.org with GitHub/Google, add a subdomain, e.g.
   `file106` → `file106.duckdns.org`.
2. Set its IP to the instance's public IPv4.
3. Confirm before going further — the certificate cannot be issued otherwise:

```bash
nslookup file106.duckdns.org
# must answer with your VPS IP
```

If the IP ever changes, update it in the DuckDNS dashboard (or via the token
URL) and restart Caddy only if the certificate was never issued.

**What this name cannot do:** DuckDNS holds A records only, so you cannot add
SPF, DKIM, or DMARC records. That affects email (§4), not the site.

**Skip this section if you took door 1c behind carrier-grade NAT** — the tunnel
supplies its own hostname, and none of the certificate steps below apply.

### The edge cache — optional, and only with a domain of your own

Lightsail bundles 2 TB of transfer, so this is no longer about the bill; it is
about latency and a free WAF in front of the origin. If you own a domain,
Cloudflare serves `styles.css`, `app.js` and `favicon.svg` from edge nodes and
passes HTML through — which `no-store` on `/` requires anyway. Caddy still
terminates TLS.

The catch is that Cloudflare can only front a zone you control, and a
`duckdns.org` name cannot be delegated. So:

- **No domain of your own:** stay on DuckDNS and plain Caddy TLS. Nothing breaks
  and nothing gets billed — you simply skip the edge.
- **A domain you own:** point its nameservers at Cloudflare, add an A record to
  the instance's static IP, and set the record to proxied (orange cloud) with SSL
  mode **Full (strict)**. DuckDNS then becomes unnecessary, and §4's mail problems
  go away with it.

Which is why a real domain is the first thing worth buying — see "Cost" below.

---

## 3. The RPC — Helius free tier

1. Sign up at helius.dev, create an app on **mainnet-beta**.
2. Copy the HTTPS RPC URL — it looks like
   `https://mainnet.helius-rpc.com/?api-key=...`.
3. That key is not a wallet key and cannot move funds, but it is still a secret:
   it goes in `.env` on the server and nowhere else.

Free tier is ample here: the app makes one `getParsedTokenAccountsByOwner` call
per dashboard view or balance refresh.

---

## 4. The mail — Brevo free

The application sends exactly one kind of mail: the account verification link.

1. Sign up at brevo.com, then **Senders, Domains & IPs → Senders → Add a
   sender**. Without a domain you can only verify an individual address: enter
   a mailbox you control and click the confirmation link Brevo emails you.
2. **SMTP & API → SMTP**: note the server, port `587`, and your SMTP login
   (the login is shown as `xxxxx@smtp-brevo.com`, not your account email).
3. Generate an SMTP key to use as the password.

Then set in `.env` (port 587 uses STARTTLS; port 465 would be `smtps://`):

```bash
SMTP_URL=smtp://LOGIN:KEY@smtp-brevo.com:587
```

Percent-encode the key if it contains `@`, `:` or `/`, or use `encodeURIComponent`
to build the URL safely.

**Expect deliverability friction.** A `duckdns.org` sender has no SPF/DKIM
alignment, so some messages will land in spam. Mitigations that actually help:

- Use a plain-text message (the app already sends only a link).
- Tell your first testers to check spam and mark "not spam" — reputation builds.
- Keep volume low at launch.

`MAIL_FROM` must be the address you verified with Brevo, or mail is rejected
outright. If sending fails, the app logs the failure and the account simply
cannot verify — it does not create a half-verified account.

If mail is not configured at all, the app writes the verification link to the
server log instead. That is fine for a private test, useless for real users.

---

## 5. Configure and start

```bash
sudo mkdir -p /opt/file106 && sudo chown "$USER":"$USER" /opt/file106
git clone <your repo url> /opt/file106 && cd /opt/file106
sudo bash scripts/archive/bootstrap-vps.sh   # packages, swap, firewall, Docker

node scripts/archive/init-env.mjs \
  --domain file106.duckdns.org \
  --rpc "https://mainnet.helius-rpc.com/?api-key=<helius key>" \
  --smtp "smtp://<brevo login>:<smtp key>@smtp-brevo.com:587" \
  --mail-from <the address you verified with Brevo>
```

`init-env` writes `.env` at mode 600, generates `POSTGRES_PASSWORD`,
`SESSION_SECRET` and `ANSWER_ENC_KEY`, derives `SITE_ORIGIN` from `--domain` and
pins `F106_MINT_ADDRESS` to the canonical mint. It reports what it wrote and
never the values, so no secret lands in your scrollback or shell history.
Re-running it refuses to overwrite without `--force`. Omit `--smtp` to have
verification links written to the log instead of mailed.

`SITE_ORIGIN` must equal `https://` + `SITE_DOMAIN` exactly — the wallet
message embeds it verbatim, and the server rebuilds that same string when it
verifies the signature. `init-env` derives both from the same argument for that
reason; do not hand-edit one afterwards.

**Back up `ANSWER_ENC_KEY` off the server now** (password manager, printed
paper). Open `.env`, copy that one line, and store it somewhere else. From
Stage 4 it encrypts submitted answers; lose it and pending submissions are
permanently unreadable, and it is not recoverable from anywhere.

Then the gate, then the deploy:

```bash
node scripts/archive/preflight.mjs     # live-checks env, RPC and SMTP
docker compose up -d --build
docker compose ps
```

If a variable is exported in your shell it wins over `.env`, which makes a stale
value look like it came from the file. `preflight` prints the names of any such
variables at the top of its report, so unset them before believing the result.

`preflight` exits non-zero while anything would break the deploy, and it never
prints a secret value. Expected output on a healthy box: `0 failures`.

The `migrate` service applies every migration in `db/migrations/` and exits;
`app` starts only after it succeeds. Caddy obtains the certificate on first
request to the hostname.

## 6. Verify

```bash
curl -fsS https://file106.duckdns.org/healthz          # {"status":"ok"}
curl -fsSI https://file106.duckdns.org/ | head -n 5     # 200, HSTS present
```

Then in a browser: the trust page at `/`, register an account, confirm the
verification mail arrives (or read the link from `docker compose logs app`),
sign in, and link a wallet on `/dashboard` by signing the message. Nothing moves
funds at any point.

The panel is closed until an archivist exists, and there is no web sign-up for
one. Create the first account from the shell; the password is prompted for
without echo and never stored in readable form:

```bash
docker compose exec app node scripts/archive/create-admin.mjs \
  --email you@example.org --name "Your Name" --role owner
```

Then `/admin/login` works, `/archive` is empty until you publish a file, and
uploading an exhibit writes into the `uploads_data` volume.

## 7. Operations

```bash
docker compose logs -f app            # request log and errors
docker compose restart app            # after editing .env
git pull && docker compose up -d --build   # deploy an update (migrations run first)
```

Nightly backups — two kinds of state, both irreplaceable in different ways. The
database holds every record; the `uploads_data` volume holds the exhibit bytes
those records point at. A dump alone restores rows whose files no longer exist:

```bash
sudo mkdir -p /var/backups/file106
( crontab -l 2>/dev/null; echo '15 3 * * * cd /opt/file106 && docker compose exec -T db pg_dump -Fc -U file106 file106 > /var/backups/file106/file106-$(date +\%F).dump' ) | crontab -
( crontab -l 2>/dev/null; echo '45 3 * * * cd /opt/file106 && docker run --rm -v file106-archive_uploads_data:/data:ro -v /var/backups/file106:/backup alpine tar czf /backup/uploads-$(date +\%F).tar.gz -C /data .' ) | crontab -
```

Copy those files off the box weekly; a backup that only exists on the machine
that dies is not a backup. Restore test: `pg_restore -d file106 <file>.dump`
into a scratch database, and untar one uploads archive into a scratch volume to
confirm the bytes still open.

---

## Cost, and the one thing worth paying for

| Item | Door 1a (Lightsail) | Door 1b (Hetzner) | Door 1c (your machine) |
|---|---|---|---|
| Host | trial + credits, then $7 list | ~€4 | €0 |
| DuckDNS subdomain | €0 | €0 | €0 (or the tunnel's own name) |
| Helius free RPC | €0 | €0 | €0 |
| Brevo free mail | €0 | €0 | €0 |
| Cards involved | 1, charged after the trial | 1, charged monthly | none |

So the cost today is **nothing**: door 1c forever, and door 1a for as long as the
three-month trial and the new-account credits last, which is comfortably most of
a year at $7 list. The bill only arrives when both run out, and by then you can
stop the instance, downgrade to door 1c, or decide the archive earns it.

**The second thing worth buying is a real domain (~€10/yr).** Not because of the
site — DuckDNS works fine for TLS. Because of **email**: only a domain you control
can carry SPF and DKIM, which is the difference between "verification mail
sometimes in spam" and "verification mail arrives". It is also the only way to put
an edge cache in front (§2), which is a latency and WAF improvement rather than
the budget necessity it would have been on Google's free tier.

Switching to a real domain later is safe and does not disturb existing accounts:

```bash
SITE_DOMAIN=file106.xyz
SITE_ORIGIN=https://file106.xyz
```

then `docker compose restart app` (and update the DuckDNS-free DNS A record).
Wallets already linked stay linked: the origin is only used inside the
challenge/verify pair for *new* signatures. Only the historical `proof_message`
text stored for earlier links still names the old host — a cosmetic record, not
a functional dependency.

---

## Known limits of this deployment

| Limit | Door | Consequence | Mitigation |
|---|---|---|---|
| Only 1 GB of RAM | 1a | An unbounded Postgres is OOM-killed under load | `docker-compose.yml` bounds it; 2 GB swap from `bootstrap-vps.sh`; do not raise `shared_buffers` to feel faster |
| The free trial ends | 1a | $7/month begins, charged to the card | Calendar note for the end date; door 1b is cheaper if the bill matters |
| A detached static IP is billed | 1a | A forgotten IP costs a few dollars a month | Keep it attached to the instance, or release it |
| Credits expire | 1a | The 6-month Free plan credits stop covering anything | Check **Billing → Credits** once; do not assume credits are perpetual |
| Ephemeral public IP changes on stop/start | 1b | DNS points at nothing | Attach a reserved/static IP before pointing any name at it |
| The machine is also your computer | 1c | A reboot, a power cut, a Windows update is an outage; and home upload carries every request | Private beta only. Do not run a reward window on it |
| No SPF/DKIM on a DuckDNS sender | all | Verification mail may hit spam | Low volume, plain text, verified sender; move to a real domain when you can |
| Public RPC would rate-limit | all | Balance reads fail with 503 | Helius key, as above |
| Single VPS, single database | all | Hardware failure loses the box | Backups off-box; restore drill before you invite real users |
| One `app` process | all | A restart drops in-flight requests | `restart: unless-stopped` plus Caddy retrying; acceptable at this scale |
