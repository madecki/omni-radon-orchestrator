# OmniRadon — local workspace orchestrator

This repository exists to make local development of the OmniRadon multi-repo stack frictionless. It does **not** contain application code.

---

## What this repository is

- A place to clone and update all service repositories with a single command
- A single-command way to start the full local development stack
- A bootstrap script for first-time setup
- Workspace-level Cursor rules for cross-repo AI assistance
- Documentation of the local stack

## What this repository is NOT

- A monorepo — the services remain fully independent
- A shared library — no `packages/` or `src/` directories here
- A source of truth for business logic
- A replacement for per-repository configuration or CI pipelines

---

## Repository structure

```
OmniRadon/                   ← this workspace repo
├── .cursor/
│   └── rules/
│       └── workspace.mdc    ← cross-repo Cursor rules
├── scripts/
│   ├── lib.mjs              ← shared helpers (paths, repos.conf, PATH checks)
│   ├── clone.mjs            ← clone all repos
│   ├── pull.mjs             ← pull updates in all repos
│   ├── bootstrap.mjs        ← full first-time setup
│   ├── dev.mjs              ← start full dev stack
│   ├── stop.mjs             ← stop all running services
│   └── logs.mjs             ← tail service logs (prefixed or single)
├── run.mjs                  ← cross-platform CLI (Windows, macOS, Linux)
├── repos.conf               ← centralized repo URL list
├── Makefile                 ← optional shortcuts (calls `node run.mjs …`)
├── .env.example             ← workspace env reference
├── .gitignore
├── README.md
│
├── shell/                   ← cloned repo (git-ignored here)
├── gateway/                 ← cloned repo (git-ignored here)
├── auth-service/            ← cloned repo (git-ignored here)
└── diary/                   ← cloned repo (git-ignored here)
```

### Cross-platform commands

Orchestration is implemented in **Node.js** (no Bash required). Use from the workspace root:

| Command | Purpose |
|--------|---------|
| `node run.mjs help` | List commands |
| `node run.mjs clone` | Clone all repos |
| `node run.mjs pull` | Pull all repos |
| `node run.mjs bootstrap` | Clone + `pnpm install` + env hints |
| `node run.mjs dev` | Start the full stack |
| `node run.mjs stop` | Stop tracked services + port cleanup |
| `node run.mjs logs` | Tail all logs (prefixed) |
| `node run.mjs logs gateway` | Tail one service |
| `node run.mjs logs gateway shell` | Tail several (prefixed) |

On macOS/Linux, if `make` is installed, `make dev` and the other Makefile targets work the same way (they call `node run.mjs …`).

---

## Prerequisites

| Tool   | Purpose                         |
|--------|---------------------------------|
| git    | Cloning and pulling repos       |
| node   | Running JS/TS services          |
| pnpm   | Dependency management           |
| docker | Databases and NATS (via compose)|

---

## Quick start (first time)

### 1. Configure repo URLs

Open `repos.conf` and replace the placeholder URLs with your actual remote URLs:

```
shell         git@github.com:your-org/shell.git
gateway       git@github.com:your-org/gateway.git
auth-service  git@github.com:your-org/auth-service.git
diary         git@github.com:your-org/diary.git
```

### 2. Bootstrap the workspace

```bash
node run.mjs bootstrap
```

(or `make bootstrap` if you use Make)

This will:
1. Clone all repositories (skips any already present)
2. Run `pnpm install` in each repo
3. Check for missing `.env` files and tell you what to fill in

### 3. Configure environment files

The bootstrap output will flag any missing `.env` files. At minimum:

```bash
cp gateway/.env.example gateway/.env
# fill in gateway/.env

cp auth-service/.env.example auth-service/.env
# fill in auth-service/.env
```

Shell and diary do not require manual `.env` setup for local development.

### 4. Start the stack

```bash
node run.mjs dev
```

---

## Day-to-day commands

| Command | What it does |
|---------|----------------|
| `node run.mjs clone` | Clone all repos (safe to re-run, skips existing) |
| `node run.mjs pull` | `git pull --ff-only` in every repo |
| `node run.mjs bootstrap` | Full first-time setup (clone + install + checks) |
| `node run.mjs dev` | Start the full development stack |
| `node run.mjs stop` | Stop all running services |
| `node run.mjs logs` | Tail logs: all services (prefixed) |
| `node run.mjs logs <name>` | Tail one service |
| `make …` | Same as `node run.mjs …` if Make is available (e.g. `make logs S=gateway`) |

---

## Service ports

| Service        | URL                          | Notes                             |
|----------------|------------------------------|-----------------------------------|
| Gateway        | http://localhost:3000        | **Use this as the entry point**   |
| Shell          | http://localhost:3001        | Login / register UI               |
| Auth Service   | http://localhost:4001        | RS256 JWT, JWKS, refresh tokens   |
| Diary Web      | http://localhost:4280        | Diary MFE (Next.js)               |
| Diary API      | http://localhost:4281        | REST API for diary entries        |
| Auth Postgres  | localhost:5433               | Auth service database             |
| Diary Postgres | localhost:54320              | Diary database                    |
| NATS           | localhost:42220              | JetStream (diary worker)          |

Always access the application through the **gateway on port 3000**. Do not use the service ports directly in a browser.

---

## Logs

When running `node run.mjs dev`, each service writes its output to `./logs/<service>.log` (auth-service, diary, gateway, shell).

**All services in one terminal** (each line prefixed with `[service]`):
```bash
node run.mjs logs
```

**Single service** (in a separate terminal):
```bash
node run.mjs logs gateway
```

**A subset of services** in one terminal (prefixed):
```bash
node run.mjs logs gateway shell
```

With Make (optional): `make logs` or `make logs S=gateway`.

You can still open log files in any editor, or use your platform’s `tail` if you prefer.

---

## Stopping the stack

Press `Ctrl+C` in the terminal running `node run.mjs dev`, or in a separate terminal:

```bash
node run.mjs stop
```

This sends `SIGTERM` to all tracked processes. If any service uses Docker Compose internally (auth-service, diary), you may also need to stop those containers:

```bash
docker ps                              # check running containers
cd auth-service && docker compose down
cd diary && docker compose -f infra/docker-compose.yml down
```

---

## Architecture overview

```
Browser
  └── Gateway :3000
        ├── /                → Shell :3001      (auth UI, MFE entry)
        ├── /auth/*          → Auth Service :4001
        ├── /app/diary       → Diary Web :4280
        └── /diary/*         → Diary API :4281

Background:
  Diary Worker → NATS JetStream :42220
```

Auth flow: `Shell` collects credentials → `Auth Service` issues RS256 JWT → token passed via hash fragment to `Diary Web` → `Gateway` validates JWT via JWKS on every request.

---

## How startup works

`node run.mjs dev` starts services in this order:

1. **auth-service** — `pnpm dev` (starts Postgres via Docker Compose, runs Prisma migrate, starts NestJS in watch mode)
2. **diary** — `pnpm start` (starts Postgres + NATS via Docker Compose, runs Prisma migrate, starts all Turbo apps)
3. *(15-second wait for databases to become ready)*
4. **shell** — `pnpm dev` (Next.js dev server)
5. **gateway** — `pnpm dev` (NestJS in watch mode)

Each service handles its own infrastructure. The workspace script does not manage Docker directly.

---

## Pulling updates

```bash
node run.mjs pull
```

This runs `git pull --ff-only` in every cloned repo. It will skip repositories that are not yet cloned and report failures clearly if a pull would diverge. It does not force-push, reset, or stash anything.

---

## What requires manual configuration

The following cannot be fully automated and require manual steps:

| Item                              | Where                                  |
|-----------------------------------|----------------------------------------|
| Service `.env` files              | `gateway/.env`, `auth-service/.env`    |
| SSH keys / GitHub access          | Your local git configuration           |
| RSA key pair for JWT signing      | `auth-service/.env` (see its README)   |
| `GATEWAY_SERVICE_TOKEN` value     | Both `gateway/.env` and `diary/.env`   |
| Docker Desktop                    | Must be running before `node run.mjs dev` |

Refer to the README in each individual repository for the full setup details.

---

## Cursor — cross-repo work

This workspace includes `.cursor/rules/workspace.mdc` with guidance for AI-assisted development across repositories. When you open this workspace root in Cursor, those rules are applied automatically.

Key principles in the rules:
- Identify which repository owns a domain before making changes
- Never add business logic to this workspace repo
- Inspect all affected repos before implementing a cross-repo feature
- Commit changes to each repository independently

Repository-specific rules (framework conventions, domain standards) live in each repo's own `.cursor/rules/` directory. Do not duplicate them here.

---

## Individual repositories

Each repository is fully independent:

| Repository   | Owns                                              |
|--------------|---------------------------------------------------|
| `shell`      | Auth UI, MFE shell, login/register page           |
| `gateway`    | Routing, JWT validation, rate limiting, CORS      |
| `auth-service` | User accounts, JWT issuance, JWKS, key rotation |
| `diary`      | Diary entries, editor UI, outbox events, worker   |

This workspace repo does not override or duplicate anything owned by those repositories.
