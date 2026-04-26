# Contributing

Thanks for helping improve FlatClaw Console.

- For external bugs and feature requests: please use GitHub Issues.
- For repo work tracked by our on-host agent squad: we use Notion.

## Before you start
- Install OpenClaw and confirm the gateway runs locally.
- This repo is UI-only and reads config from `~/.openclaw`.
- It does not run or build the gateway from source.

## Local setup
```bash
git clone https://github.com/grp06/flatclaw-console.git
cd flatclaw-console
npm install
cp .env.example .env
npm run dev
```

## Testing
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run e2e` (requires `npx playwright install`)

## UX audit cleanup
- For `localhost-ux-improvement` runs, always clean generated UX artifacts before committing:
  - `npm run cleanup:ux-artifacts`
- This clears `output/playwright/ux-audit/`, `.agent/ux-audit.md`, and `.agent/execplan-pending.md`.

## Task tracking

We track implementation work for this repo in Notion.

## Pull requests
- Keep PRs focused and small.
- Prefer **one task → one PR**.
- Include the tests you ran.
- Link to the relevant issue/task.
- If you changed gateway behavior, call it out explicitly.

## Reporting issues
When filing an issue, please include:
- Reproduction steps
- OS and Node version
- Any relevant logs or screenshots

## Minimal PR template
```md
## Summary
- 

## Testing
- [ ] Not run (explain why)
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run e2e`

## AI-assisted
- [ ] AI-assisted (briefly describe what and include prompts/logs if helpful)
```

## Minimal issue template
```md
## Summary

## Steps to reproduce
1.

## Expected

## Actual

## Environment
- OS:
- Node:
- UI version/commit:
- Gateway running? (yes/no)

## Logs/screenshots
```
