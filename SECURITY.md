# Security Model

Truebuntu manages ZFS pools, system users, network configuration, and services on
its host. Doing that requires privilege, and the design does not pretend
otherwise. This document states plainly what the trust boundaries are, so that
neither a contributor nor an operator has to infer them from the code.

> **This project is not production-ready.** See the warning at the top of the
> README. What follows describes the intended model, not a security guarantee.

## The one-line version

**An admin of the web UI is root on the host.** That is the product, not a
defect. Authentication is therefore the only boundary that matters.

## What the container is

`docker-compose.yml` runs the container `privileged`, with `network_mode: host`
and `pid: host`, and bind-mounts `/etc/passwd`, `/etc/group`, `/etc/samba`,
`/etc/netplan`, and others. The application uses `nsenter -t 1` to enter PID 1's
namespaces, which is how it manages the host rather than the container.

This is a deliberate trade: a NAS control plane that cannot change the host is
not a NAS control plane. The consequence is that container escape is not part of
the threat model — the container is not a sandbox and was never intended as one.

## Admin access is root access

Three features hand an admin arbitrary command execution on the host, by design:

| Feature | Mechanism |
|---|---|
| Web shell | `nsenter -t 1 … /bin/bash` over a WebSocket |
| Cron jobs | `sh -c <user string>` via the job runner |
| Init/shutdown scripts | `sh -c <user string>` via `nsenter` |

Cron jobs and init scripts genuinely need pipes and redirection, so they take a
shell string rather than an argv list. That is intended. Anyone who can reach
these features can already do anything the host's root account can do.

### What this means for input validation

Because admin already equals root, **validating shell metacharacters in
admin-supplied arguments buys nothing.** An earlier version of `utils/shell.py`
rejected `;`, `|`, `&`, `$`, and backticks in subprocess arguments. Every call
site runs `subprocess.run(..., shell=False)`, where those characters are ordinary
bytes with no interpreter to act on them — so the check blocked nothing, while
rejecting legitimate values and reading like a boundary that did not exist. It
has been removed.

`ALLOWED_COMMANDS` in `utils/shell.py` remains, but as a **typo catcher**: it
makes a mistyped or unexpected binary fail loudly at the call site. It is not a
containment mechanism and must not be relied on as one — `nsenter` is on the
list, which alone makes the set unenforceable as a boundary.

Validation that *is* meaningful, and is kept:

- **Config-file injection.** Values written into `/etc/exports`, `ddclient.conf`,
  `smb.conf`, and netplan YAML are checked for newlines, because a newline lets a
  value become a new directive. This is a real boundary and unrelated to shells.
- **Structural validation.** Interface names, CIDR addresses, UIDs, cron
  expressions, and usernames are format-checked so malformed input fails with a
  clear 400 rather than a confusing failure deeper down.
- **Path traversal.** The SPA catch-all canonicalises with `realpath` and
  verifies the result stays under the static directory.

## The boundaries that are real

### 1. Authentication

Everything hinges here. Sessions are JWTs in an `HttpOnly`, `SameSite=Strict`
cookie, and `resolve_session()` in `utils/auth.py` is the single gate every
authenticated entry point passes through — the HTTP dependency and the shell
WebSocket alike. It checks:

- signature and expiry;
- that the token was minted as a session token, not for another purpose; and
- that the token's `ver` claim still matches the user's `token_version`.

That last check is what makes revocation real. Logout, a password change, and an
admin password reset all increment `token_version`, invalidating outstanding
sessions. **Any new code path that authenticates a user must call
`resolve_session()`** — not decode the JWT itself.

Passwords are bcrypt-hashed. TOTP secrets are encrypted at rest with a key
derived from `SECRET_KEY`, which means rotating `SECRET_KEY` makes existing TOTP
secrets undecryptable and locks out every 2FA user. Rotating it is not currently
a safe operation.

### 2. Admin versus non-admin

Non-admin accounts get read-only visibility: dashboard, pools, datasets,
snapshots, shares, disks, services, jobs. Every mutating endpoint requires
`get_current_admin`.

This is enforced at the router, not per-endpoint —
`APIRouter(..., dependencies=[Depends(get_current_admin)])` — so a new endpoint
inherits the gate rather than needing to remember it. **Keep it that way.** The
failure mode of the router-level pattern is "too locked down"; the failure mode
of per-endpoint decorators is a forgotten one.

### 3. First-run setup

`/api/auth/setup` must accept unauthenticated requests — there is no account to
authenticate against yet. On a host-networked appliance that would otherwise mean
anyone reaching port 80 before the operator could claim the admin account, and
with it the web shell.

A one-time token, generated in memory and printed to the container log, is
required. Claiming the appliance therefore needs log access, not merely network
access. The token is retired once setup succeeds, and a restart mints a new one.

## Deployment assumptions

Truebuntu assumes a **trusted local network** and does not meet those assumptions
on its own:

- **No TLS.** It serves plain HTTP on port 80. Session cookies get the `Secure`
  flag only when the request arrived over HTTPS or through a proxy setting
  `X-Forwarded-Proto: https`. Over plain HTTP on an untrusted network, the
  session cookie is interceptable. Put it behind a reverse proxy with TLS if the
  network is not trusted.
- **Do not expose it to the internet.** The admin UI is a root shell with a login
  form. If remote access is needed, use a VPN.
- **`SECRET_KEY` must be unique per install.** The app refuses to start without
  one. `install.sh` generates it with `openssl rand -hex 24`.
- **Host security is the operator's.** Truebuntu manages the host; it does not
  harden it.

## Hardening that is in place

Not boundaries in themselves, but they raise the cost of the obvious attacks:

- `HttpOnly` + `SameSite=Strict` cookies, which closes CSRF without a token
  exchange.
- Rate limiting on login, setup, password change, and 2FA verification.
- Optional TOTP two-factor, with replay rejection inside a time window.
- Origin validation on the shell WebSocket.
- Audit logging of every mutating API call, with the authenticated username and
  source IP.
- Security headers, including a CSP on non-API routes.
- Passwords piped to `chpasswd`/`smbpasswd` on stdin, never in `argv`, so they do
  not appear in `/proc/<pid>/cmdline`.
- Resource limits on the container (2 GB memory, 256 PIDs).

## Contributing safely

If you are adding code, the rules that matter:

1. **Authenticate through `resolve_session()`.** Never decode the session JWT
   directly — you will miss the revocation check.
2. **Gate routers, not endpoints.** Add `dependencies=[Depends(get_current_admin)]`
   to the `APIRouter`.
3. **Prefer argv lists over shell strings.** Use `cmd=[...]`; reach for
   `shell_cmd` only when pipes or redirection are genuinely required, and
   `shlex.quote()` every interpolated value when you do.
4. **Validate what actually matters** — newlines in anything written to a config
   file, and structural format — rather than shell metacharacters in argv.
5. **Never put a secret in `argv`.** Use stdin.

## Reporting a vulnerability

Open an issue at https://github.com/midyear66/Truebuntu/issues. For something you
would rather not disclose publicly, use GitHub's private vulnerability reporting
on the repository's Security tab.

Please do not report as vulnerabilities the behaviours documented above as
intentional — that an admin can run commands as root, or that the container is
privileged. Those are the design. A way for a *non-admin* or an *unauthenticated*
caller to reach them very much is a vulnerability, and is worth reporting.
