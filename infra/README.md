# Running your own Orwell server

This folder runs a homeserver and the web app with Docker Compose. One server
can host many communities. The server stores only ciphertext and the metadata
listed in [`docs/THREAT-MODEL.md`](../docs/THREAT-MODEL.md).

## What is here

| File | What it does |
|---|---|
| `Dockerfile` | Builds two images from source: `server` (the homeserver and the call relay) and `web` (Caddy serving the app and proxying `/_enclave/*`) |
| `docker-compose.yml` | Runs both, with their own network and volumes |
| `.env.example` | Every setting, explained. Copy it to `.env` |
| `Caddyfile` | The web container's configuration |
| `nginx-enclave.conf` | An example host nginx block, for when nginx already owns ports 80 and 443 |
| `quota-vnstat.sh`, `quota-vnstat.cron` | Optional. Lowers video quality near a monthly traffic quota |

## Before you start

- A Linux host with Docker and the Compose plugin.
- A domain that points to the host.
- **Choose the domain carefully.** Every account address includes it. If you
  change it later, everyone has to create a new account.

## Start

```bash
cd infra
cp .env.example .env     # set ENCLAVE_DOMAIN first
docker compose up -d --build
```

Then open `https://<your domain>/app/`.

There are two ways to expose it:

- **Standalone.** Caddy takes ports 80 and 443 and gets its own TLS
  certificate. Set nothing else. In this mode, copy the security headers from
  `nginx-enclave.conf` into the `Caddyfile`, because only the nginx block sets
  them.
- **Behind a proxy.** Your nginx (or traefik) handles TLS and forwards to the
  container on loopback. Set `ENCLAVE_SITE_ADDRESS=:80` and
  `ENCLAVE_HTTP_BIND=127.0.0.1:8080`, then adapt `nginx-enclave.conf`: replace
  `orwell.pt` with your domain. The `trusted_proxies` line in the `Caddyfile`
  must match the gateway of the Compose network, or every user appears to have
  the same IP address and the per-IP limits apply to the whole server.

## Calls

Calls work without extra setup: clients connect to each other directly. For
larger calls, turn on the relay (SFU):

```bash
ENCLAVE_SFU_PORT=44300
ENCLAVE_SFU_ANNOUNCED_IP=<the host's public IP>
```

Open that port for both UDP and TCP in the firewall. Inside Docker, the
announced IP is required. Without it, calls negotiate and then never connect.

## The settings that matter

- `ENCLAVE_RETENTION_DAYS`: how long the server keeps encrypted messages for
  people who are offline. `0` keeps nothing after live delivery. This is your
  strongest privacy setting.
- `ENCLAVE_FEDERATION_ALLOWLIST`: empty means federation is off. Only name
  servers you trust.
- `ENCLAVE_COMMON_ROOM`: a room every account on the server can join. Treat it
  as public.
- `ENCLAVE_COMMUNITY_MODE`: lets every account see which other accounts exist.
  Leave it off unless your users already know each other.
- `ENCLAVE_LOG`: not passed by the Compose file, on purpose. An access log is a
  record of what each user does.

## Back up

The `server-data` volume is the only state worth keeping. It holds the SQLite
database, the server's signing key (`server.key.json`) and the `denuncias/`
folder with reports. Keep the key: a new key means peers and clients see a
different server. Back it up encrypted, because the database holds metadata.

## Update

```bash
git pull
cd infra && docker compose up -d --build
```

Clients reconnect on their own.

## Optional extras

- **Desktop installers.** The web container serves `/opt/enclave/transferencias`
  on the host at `/transferencias/`. `scripts/publicar-instaladores.mjs` builds
  the download page with SHA-256 sums and copies the files there.
- **Traffic quota.** Install `quota-vnstat.cron` in `/etc/cron.d/` and set
  `ENCLAVE_QUOTA_MENSAL_TB`. The script writes to `/opt/enclave/quota`, which
  the server reads.

## Operator scripts

These run from a checkout of this repository. By default they work on a local
database. To work on a server, set `ORWELL_ALVO=producao` and
`ORWELL_SSH=user@host` (and `ORWELL_SSH_KEY` if you need a specific key).

| Script | What it does |
|---|---|
| `scripts/denuncias.mjs` | Read, close and act on reports. A person decides; nothing suspends on its own |
| `scripts/destrancar-canal.mjs` | Unlock a channel stuck on a forged MLS epoch |
| `scripts/limpar-servidor.mjs` | Wipe the server state for a test. Asks for confirmation |
| `scripts/trafego-do-mes.mjs` | This month's traffic against the quota. Always reads the server over SSH, so it needs `ORWELL_SSH` |

Each script explains its options at the top of the file.
