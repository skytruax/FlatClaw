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
- This repository — Console, FlatClaw Memory, infra scripts, inference Dockerfile + entrypoint, branding assets, documentation.
- The published GHCR image [`ghcr.io/skytruax/flatclaw-inference:latest`](https://github.com/skytruax/FlatClaw/pkgs/container/flatclaw-inference).

**Out of scope** (please report upstream):
- Upstream OpenClaw — [github.com/steipete/openclaw](https://github.com/steipete/openclaw)
- Upstream openclaw-studio (this Console is forked from it) — [github.com/grp06/openclaw-studio](https://github.com/grp06/openclaw-studio)
- Upstream SGLang — [github.com/sgl-project/sglang](https://github.com/sgl-project/sglang)
- Gemma 4 model weights, distributed by Google under [Gemma Terms of Use](https://ai.google.dev/gemma/terms)
- Northflank, Google Cloud Platform, or Kaggle — please use their respective vulnerability-reporting channels.

## Supported versions

FlatClaw is at v0.1.0. Only the latest released tag is supported with security fixes. As the project moves through subsequent releases, only the most recent minor version will receive backports.

## Disclosure expectations

We follow coordinated disclosure. Please give us a reasonable window (typically 90 days, or sooner if a fix is already in flight) before public disclosure. We will credit reporters who follow this process in the release notes for the patched version.
