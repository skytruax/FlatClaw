import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEMPLATE_DIR = join(process.cwd(), "lib/openclaw/templates");

function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATE_DIR, name), "utf8");
}

export interface IdentityFields {
  identityName: string;
  identityEmoji: string | null;
  email: string;
  agentId: string;
}

/** Returns IDENTITY.md pre-filled with the user's name + emoji + email. */
export function buildIdentityMd(args: IdentityFields): string {
  return `---
summary: "Agent identity record"
title: "IDENTITY"
---

# IDENTITY.md - Who Am I?

- **Name:** ${args.identityName}
- **Creature:** AI agent
- **Vibe:** Warm, sharp, helpful — focused on getting things done for ${args.identityName}.
- **Emoji:** ${args.identityEmoji ?? "🤖"}
- **Avatar:**
- **Email:** ${args.email}
- **Agent id:** \`${args.agentId}\`

---

This agent operates inside FlatClaw. It serves a single user (${args.identityName}) and acts on their behalf for tasks like email, file editing, and tool use.
`;
}

/** Returns USER.md pre-filled with the human's name. */
export function buildUserMd(args: IdentityFields): string {
  return `---
summary: "User profile record"
title: "USER"
---

# USER.md - About Your Human

- **Name:** ${args.identityName}
- **What to call them:** ${args.identityName}
- **Email:** ${args.email}
- **Timezone:** _(unknown — ask on first chat)_
- **Notes:**

## Context

_(Build this over time as you learn about them. Respect the difference between learning about a person and building a dossier.)_
`;
}

/**
 * Returns the set of default workspace files the portal seeds at provisioning
 * time. Each entry is { name, content }. SOUL.md is generated separately by
 * agent-mapper.buildSoul() because it's the identity prompt.
 */
export function buildWorkspaceDefaults(args: IdentityFields): {
  name: string;
  content: string;
}[] {
  // AGENTS.md and TOOLS.md are written by syncSkillsForUser instead — they
  // depend on which skills are enabled and need to regenerate when that
  // changes. Keep the rest as static templates.
  return [
    { name: "BOOTSTRAP.md", content: loadTemplate("BOOTSTRAP.md") },
    { name: "HEARTBEAT.md", content: loadTemplate("HEARTBEAT.md") },
    { name: "IDENTITY.md", content: buildIdentityMd(args) },
    { name: "USER.md", content: buildUserMd(args) },
  ];
}
