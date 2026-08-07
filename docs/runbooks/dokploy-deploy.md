# Deploying the stack to Dokploy

One compose file brings up the whole system: Postgres, Redis, the Medusa backend
(API + admin) and the Next.js storefront. Dokploy builds both images from this
repository and puts the two web-facing services behind its Traefik proxy with
automatic TLS.

**Files involved**

| File | Role |
| --- | --- |
| `docker-compose.prod.yml` | The stack. Point Dokploy at this. |
| `apps/backend/Dockerfile` | Medusa image (`runner` target) |
| `apps/storefront/Dockerfile` | Next.js image (`runner` target) |
| `docker-compose.yml` | **Local development only.** Untouched, still just Postgres. |

---

## Before the first deploy

1. **DNS first.** Point A records for both domains at the server, and wait for
   them to actually resolve. Let's Encrypt validates over HTTP, so a domain that
   is still propagating fails certificate issuance and Traefik falls back to its
   self-signed certificate — the browser warning that follows looks like a
   broken deploy but is really a DNS timing problem.
2. **Dokploy installed**, which creates the shared `dokploy-network` the compose
   file expects to already exist.
3. **A database dump ready** if you are carrying over existing data. See
   [Migrating the database](#migrating-the-database).

---

## Environment variables

In Dokploy: your Compose service → **Environment**. Paste the block below and
fill it in.

Variables marked `[BUILD]` are baked into the storefront image at build time.
Next.js inlines every `NEXT_PUBLIC_*` value into the JavaScript it sends to the
browser, so changing one requires a **rebuild** (Deploy), not a restart. A
restart keeps serving the old value.

```dotenv
# --- Stack identity ---
# Prefix for Traefik router names. Only change it if you run a second copy of
# this stack on the same server: duplicate router names collide and one of the
# two domains silently stops resolving.
STACK_NAME=mandi

# --- Domains ---
BACKEND_DOMAIN=api.tudominio.com
STOREFRONT_DOMAIN=tudominio.com

# --- Database ---
POSTGRES_USER=medusa
POSTGRES_DB=medusa
# Avoid @ : / ? # here. This gets interpolated into a DATABASE_URL, where those
# are URL delimiters — they truncate the connection string and surface as a
# confusing "role does not exist".
POSTGRES_PASSWORD=

# --- Secrets ---  generate each with: openssl rand -base64 32
# Rotating either invalidates every active customer session and admin login.
JWT_SECRET=
COOKIE_SECRET=

# Key-encryption key for the provider credentials stored encrypted in the DB.
# Must be base64 or hex decoding to exactly 32 bytes.
# CRITICAL when restoring a dump: it must be the SAME value as the environment
# the dump came from. A wrong key does not error — every payment and shipping
# provider just resolves as unconfigured and quietly stops working.
PROVIDER_SETTINGS_ENCRYPTION_KEY=

# --- Backend ---
# Allowed ORIGINS: scheme + host, no trailing slash, no path. Comma-separated.
# A mismatch appears in the browser as an opaque CORS error against a backend
# that is otherwise perfectly healthy.
STORE_CORS=https://tudominio.com
ADMIN_CORS=https://api.tudominio.com
AUTH_CORS=https://api.tudominio.com,https://tudominio.com

# Public origin the backend gives payment providers for webhook callbacks.
# Mercado Pago calls this from the internet, so it cannot be an internal name.
BACKEND_PUBLIC_URL=https://api.tudominio.com

# --- Storefront [BUILD] ---
# The PUBLIC backend URL, never http://backend:9000. The storefront uses one
# value for both server-side rendering and browser requests
# (apps/storefront/src/lib/config.ts), and the browser cannot resolve Docker
# service names.
NEXT_PUBLIC_MEDUSA_BACKEND_URL=https://api.tudominio.com

# Publishable key (pk_...). It lives in the database, so a restored dump already
# has it: read it from Admin > Settings > Publishable API Keys. The build
# hard-fails when this is empty (check-env-variables.js).
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=

NEXT_PUBLIC_BASE_URL=https://tudominio.com
NEXT_PUBLIC_DEFAULT_REGION=mx

# Optional — only when serving product images from Medusa Cloud S3.
MEDUSA_CLOUD_S3_HOSTNAME=
MEDUSA_CLOUD_S3_PATHNAME=
```

---

## First deploy

The storefront build needs a publishable key that only exists once the database
does. That ordering constraint is what makes the first deploy two passes instead
of one.

**Pass 1 — database and backend**

1. Create the Compose service in Dokploy, Compose Path `./docker-compose.prod.yml`.
2. Fill in every variable except `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`.
3. Deploy. Postgres, Redis and the backend come up; the storefront build fails on
   the missing key. That failure is expected at this point.
4. Restore your dump (next section), or create an admin user on a fresh database:
   ```bash
   docker exec -it <backend-container> npx medusa user -e tu@email.com -p tupassword
   ```

**Pass 2 — storefront**

5. Open `https://api.tudominio.com/app`, go to Settings → Publishable API Keys,
   copy the `pk_...` value.
6. Paste it into `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` and redeploy. All four
   services come up.

---

## Migrating the database

The backend container runs `medusa db:migrate` on every start, so schema changes
apply themselves. Restoring a dump only moves the *data*.

**Take the dump** from your local dev Postgres:

```bash
docker exec mandi-postgres pg_dump -U medusa -d medusa -Fc -f /tmp/mandi.dump
docker cp mandi-postgres:/tmp/mandi.dump ./mandi.dump
```

Or from a managed provider (Neon, Supabase):

```bash
pg_dump "$DATABASE_URL" -Fc -f mandi.dump
```

`-Fc` is the custom compressed format. It restores selectively and in parallel,
unlike a plain SQL dump which is an all-or-nothing script.

**Restore it** onto the server:

```bash
scp mandi.dump usuario@servidor:/tmp/
ssh usuario@servidor
docker cp /tmp/mandi.dump <postgres-container>:/tmp/

docker exec -i <postgres-container> \
  pg_restore -U medusa -d medusa --clean --if-exists --no-owner /tmp/mandi.dump
```

- `--clean --if-exists` drops existing objects first, making the restore
  repeatable instead of erroring on every table that already exists.
- `--no-owner` skips ownership assignments referencing roles that do not exist on
  this server (very common coming from Neon).

Restart the backend afterwards so it reconnects against the restored schema.

> The dev Postgres is pinned to `postgres:16-alpine` and so is this one. Keep
> them on the same major version — `pg_restore` refuses a dump taken from a
> newer server.

---

## Redeploys

| Change | Action |
| --- | --- |
| Backend or storefront code | Deploy (rebuilds the affected image) |
| A `NEXT_PUBLIC_*` value | **Deploy**, not restart — the value is baked into the bundle |
| A backend-only variable (CORS, secrets, URLs) | Restart is enough |
| A new Medusa migration | Nothing: the container runs `db:migrate` at startup |

---

## Troubleshooting

**Backend restart-loops with a connection error.** Check `DATABASE_SSL`. It is
set to `"false"` in the compose file because this Postgres runs plaintext on a
private network. Managed Postgres needs `"true"`. The two are not
interchangeable and the failure message does not say which one is wrong.

**Storefront shows products but the cart or checkout fails.** Almost always
CORS: `STORE_CORS` must contain the storefront origin exactly, with no trailing
slash. Also confirm the publishable key baked into the build matches a key that
exists in *this* database — after a restore from a different environment, it
often does not.

**Payment or shipping providers show as unconfigured.** The
`PROVIDER_SETTINGS_ENCRYPTION_KEY` does not match the one used when those
credentials were encrypted. Either restore the original key, or re-enter the
credentials from Admin → Provider Settings.

**Traefik serves a self-signed certificate.** DNS was not resolving when the
stack first came up, so ACME validation failed. Fix the record, then redeploy to
retrigger issuance.

**Storefront build runs out of memory.** `next build` needs roughly 2GB. On a
small VPS, add swap or build the image elsewhere and push it to a registry.

---

## Image size

Both images are multi-stage: the build toolchain, dev dependencies and source
never reach the final layer.

- **Backend** builds into `.medusa/server`, a self-contained output, and installs
  only production dependencies there.
- **Storefront** uses Next.js standalone output (`output: "standalone"` with
  `outputFileTracingRoot` at the monorepo root), which traces the modules the
  server actually imports. That is the difference between shipping the installed
  workspace and shipping a pruned tree — roughly 1GB versus under 200MB.
