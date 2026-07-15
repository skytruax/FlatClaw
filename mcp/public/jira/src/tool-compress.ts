/**
 * Compress tool descriptions + Zod parameter `.describe()` strings at
 * registration time so the schema we send to the LLM stays small.
 *
 * Source code keeps its full prose (good for human readers and IDE
 * tooltips); the runtime emits the trimmed form. One-way pipeline —
 * never expanded.
 *
 * Per-tool savings target: ~40-60 % of description bytes.
 *   "Read a file's contents from the cPanel host into the model's
 *    context. Use this when you need to INSPECT or MODIFY the content.
 *    **For pure 'copy from cPanel to my workspace' use `download_file`
 *    instead** — it skips the model entirely and is far more efficient
 *    for files >5KB."
 * becomes
 *   "Read a file from cPanel into context (≤32KB inline; medium files
 *    return head+tail; >256KB refused — use download_file)."
 *
 * Compression rules:
 *   - take the first sentence (split on the first ". " not preceded by a digit)
 *   - strip markdown emphasis (** __)
 *   - strip backticks but keep the contents
 *   - collapse whitespace
 *   - cap at MAX_DESC_CHARS
 *   - if a tool has authored a multi-line "description block" (e.g. with
 *     bullet points teaching tiers), prefer the explicit `tersely:` line
 *     when present, else fall back to the heuristic
 */
import type { z } from "zod";

const MAX_DESC_CHARS = 160;
const MAX_PARAM_CHARS = 80;

export function compactDescription(desc: unknown): string {
  if (typeof desc !== "string" || !desc) return "";
  let s = desc.trim();
  // Honor an explicit "Tersely:" override if the source provides one.
  const terselyMatch = s.match(/(?:^|\n)\s*tersely:\s*([^\n]+)/i);
  if (terselyMatch) {
    return clip(strip(terselyMatch[1].trim()), MAX_DESC_CHARS);
  }
  // First paragraph only.
  s = s.split(/\n{2,}/)[0];
  // First sentence (avoid splitting on numeric decimals like "0.5.")
  const sentenceMatch = s.match(/^[\s\S]+?[.!?](?=\s|$)/);
  if (sentenceMatch) s = sentenceMatch[0];
  return clip(strip(s), MAX_DESC_CHARS);
}

function strip(s: string): string {
  // Strip markdown bold/italic/code markers but keep contents.
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  // Try to clip at a word boundary near max.
  const slice = s.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > max - 30) return slice.slice(0, lastSpace).trimEnd() + "…";
  return slice.trimEnd() + "…";
}

/**
 * Walk a Zod params schema record (the third argument to server.tool) and
 * mutate each entry to use its trimmed description. Mutation is safe: the
 * registration flow consumes the schema once at boot then doesn't reuse it.
 */
export function compactParamsSchema(
  schema: Record<string, z.ZodTypeAny> | undefined,
): Record<string, z.ZodTypeAny> | undefined {
  if (!schema || typeof schema !== "object") return schema;
  for (const key of Object.keys(schema)) {
    const entry = schema[key] as { _def?: { description?: string } };
    if (entry?._def?.description) {
      entry._def.description = clip(strip(entry._def.description), MAX_PARAM_CHARS);
    }
  }
  return schema;
}
