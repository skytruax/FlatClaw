# Security

## Reporting a vulnerability

If you discover a security vulnerability in FlatClaw, please report it privately:

- **Preferred — GitHub Security Advisories:** [Open a private advisory](https://github.com/skytruax/FlatClaw/security/advisories/new) directly against this repository.
- **Email fallback:** skyler.truax@gmail.com — please include "FlatClaw security" in the subject line.

**Do not** open a public issue for security problems. Public issues let unrelated parties weaponize the report before a fix is available.

We aim to:
- Acknowledge receipt within 48 hours.
- Provide an initial assessment + remediation timeline within 5 business days.
- Issue a coordinated disclosure with a credit to the reporter once the fix is released.

## Scope

**In scope:**
- This repository — Portal, web/, infra scripts, inference Dockerfile + entrypoint, branding assets, documentation.
- The published GHCR image [`ghcr.io/skytruax/flatclaw-inference:latest`](https://github.com/skytruax/FlatClaw/pkgs/container/flatclaw-inference).

**Out of scope** (please report upstream):
- Upstream OpenClaw — [github.com/steipete/openclaw](https://github.com/steipete/openclaw)
- Upstream SGLang — [github.com/sgl-project/sglang](https://github.com/sgl-project/sglang)
- Gemma 4 model weights, distributed by Google under [Gemma Terms of Use](https://ai.google.dev/gemma/terms)
- GLM-5.2 model weights, distributed by Z.ai under the [MIT license](https://huggingface.co/zai-org/GLM-5.2/blob/main/LICENSE)
- Northflank or Kaggle — please use their respective vulnerability-reporting channels.

## Security model, in brief

What the design promises, so reports can be judged against it. The README's
"RBAC / tool access" and "Data locality" sections go into more depth.

**Boundaries.** Only the Portal is reachable from outside a tenant. The
OpenClaw gateway RPC, the per-user MCP servers, the capability-token bridge
and the inference service bind to loopback or the tenant's internal network.
Inference never leaves the tenancy. Outbound access from agents (web fetch,
package installs) is open by design and governed by tool policy and the
approval engine, not by the network.

**Users and their agents.** Each Portal user has one OpenClaw agent. The
Portal scopes its API routes to the caller's own agent (an admin may act for
another user, and that is audited). Each user's MCP servers are hidden from
every other agent's roster by OpenClaw's own tool policy, and reach that
user's data only through capability tokens scoped to (tenant, user, service).

**Shared mode (the default).** All agents run inside one gateway process
under one operating-system account, so the separation between users is
OpenClaw's policy layer, not the kernel. A user who can make their agent run
an arbitrary shell command can reach files that belong to other users' agents
on the same host. Treat shared mode as suitable for a single team that
already shares a workspace, not for mutually untrusting users.

**Per-user mode (v0.4.0, `FLATCLAW_GATEWAY_MODE=per-user`).** One gateway per
user, each under its own system account, state directory, port and token,
supervised by the Portal, so another user's workspace, agent state and
gateway token are denied by the operating system. The Portal's own secrets
and anything credential-shaped are filtered out of every gateway's
environment. A pinned tenant baseline covers the gateway settings that
isolation depends on, with every built-in tool decided by name and an
allowlisted plugin set. Portal chat text is never interpreted as gateway
owner commands, and the browser event stream is filtered per agent. A live
contract probe checks all of it against the pinned OpenClaw version
(2026.9.8).

In shared mode, a report that shows one user reaching another user's data
through the shared account is the documented limit above; it is in scope
whenever it crosses OpenClaw's policy layer instead (for example a hidden
tool that an agent can still call). In per-user mode any cross-user reach —
another user's workspace, agent state or gateway token, or a Portal secret
visible to a gateway — is a vulnerability in the strict sense.

**Secrets.** Per-user service credentials are AES-256-GCM sealed in the Portal
database with a key the Portal alone holds; MCP servers reach a user's data
only through capability tokens scoped to (tenant, user, service).
Consequential tool actions are composed, shown for human approval, and only
then replayed with that user's own credentials; the decision and the
approver's identity are recorded in the audit log.

## Supported versions

FlatClaw is pre-1.0. Only the latest released tag is supported with security fixes. As the project moves through subsequent releases, only the most recent minor version will receive backports.

## Disclosure expectations

We follow coordinated disclosure. Please give us a reasonable window (typically 90 days, or sooner if a fix is already in flight) before public disclosure. We will credit reporters who follow this process in the release notes for the patched version.
