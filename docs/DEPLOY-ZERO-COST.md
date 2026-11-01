# Deploying THE FILE106 ARCHIVE at zero monthly cost

The stack you chose: **Oracle Cloud Always Free** (Ubuntu 24.04, ARM) +
**DuckDNS** subdomain + **Helius** free RPC + **Brevo** free mail. Every step
below is a command you run on the server, not something the app does for you.

Nothing here touches on-chain state, and no step ever asks for a wallet secret.

---

## 1. The VPS — Oracle Cloud Always Free

1. Sign up at Oracle Cloud. A card is required for identity verification and is
   not charged; the Always Free resources stay free.
2. **Your home region is permanent.** Pick the one nearest your users now — it
   cannot be changed later. Latency matters for balance reads and page loads.
3. Create an **Always Free** Ampere A1 instance:
   - Shape: `VM.Standard.A1.Flex`, **2 OCPU / 12 GB** is the sweet spot (the
     Always Free quota is 4 OCPU / 24 GB total, so one 2/12 instance leaves room
     for a second one).
   - Image: **Canonical Ubuntu 24.04**. ARM images and our multi-arch
     containers (`node:24-alpine`, `postgres:16-alpine`) match.
   - Boot volume: default (~46 GB) is fine; Always Free includes 200 GB total.
   - Upload your **SSH public key** at creation. You need a key, not a password.
4. **"Out of host capacity"** is the standard failure. Workarounds, in order:
   retry at a different time of day; try the other availability domains; try
   `1 OCPU / 6 GB` and add a second instance later; as a last resort, use a
   different region (which costs you the home-region choice).
   The free AMD micro shape (1/8 OCPU, 1 GB) is **too small** for Postgres +
   Node — do not try to make it fit.
5. Note the public IPv4. If you stop and start the instance, an *ephemeral* IP
   can change — update DuckDNS (§2) if it does. Assigning a reserved IP avoids
   the surprise.

### Open the ports — Oracle has two firewalls

Both must be open, or Caddy cannot obtain a certificate and nothing will load.

**a) Network side, in the Oracle console:** VCN → Security Lists → default →
Add Ingress Rules → source `0.0.0.0/0`, TCP **80** and **443**.
Port 22 is already allowed for SSH. Never add 5432.

**b) Host side:** Oracle's Ubuntu images ship with an iptables INPUT chain that
drops everything except SSH. This is the step people forget:

```bash
sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save            # survives reboot
```

If `sudo ufw status` reports the firewall active, also run
`sudo ufw allow 80,443/tcp`.

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

| Item | Monthly |
|---|---|
| Oracle Always Free A1 (4 OCPU / 24 GB quota) | €0 |
| DuckDNS subdomain | €0 |
| Helius free tier | €0 |
| Brevo free (300/day) | €0 |

**The one thing worth buying later is a real domain (~€10/yr).** Not because of
the site — DuckDNS works fine for TLS. Because of **email**: only a domain you
control can carry SPF and DKIM, which is the difference between "verification
mail sometimes in spam" and "verification mail arrives".

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

| Limit | Consequence | Mitigation |
|---|---|---|
| Oracle may reclaim idle instances | Instance stops; site down | Nightly dumps copied off-box; the stack rebuilds from the repo in ten minutes |
| Ephemeral public IP can change on stop/start | DNS points at nothing | Assign a reserved IP, or update DuckDNS and restart |
| No SPF/DKIM on a DuckDNS sender | Verification mail may hit spam | Low volume, plain text, verified sender; move to a real domain when you can |
| Public RPC would rate-limit | Balance reads fail with 503 | Helius key, as above |
| Single VPS, single database | Hardware failure loses the box | Backups off-box; restore drill before you invite real users |
| One `app` process | A restart drops in-flight requests | `restart: unless-stopped` plus Caddy retrying; acceptable at this scale |
