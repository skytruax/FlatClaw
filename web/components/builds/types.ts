export interface Part {
  id: string;
  role: string;
  pick: string;
  why: string;
  qty: number;
  newegg?: string | null;
  referencePrice?: number;
  referenceNote?: string;
  searchUrl?: string;
  phase?: number;
  optional?: boolean;
  tag?: string;
}
export interface Variant {
  id: string;
  title: string;
  summary: string;
  parts: Part[];
  phases?: { n: number; title: string; note: string }[];
  notes: string[];
  software?: { label: string; value: string }[];
}
export interface CloudOption {
  /** cloud-neutral service name, e.g. "GPU node" or "Control plane" */
  name: string;
  spec: string;
  hourly: number;
  monthlyWarm: number;
  spotHourly?: number;
  monthlySpot?: number;
  notes: string[];
  recommended?: boolean;
  /** the same class on each cloud, the reference lane among them */
  skus?: { cloud: string; sku: string }[];
}
export interface Build {
  id: string;
  klass: string;
  title: string;
  subtitle: string;
  model: Record<string, string>;
  glance: { v: string; l: string }[];
  quantLadder?: { tier: string; footprint: string; fits: string }[];
  local: { variants: Variant[] };
  cloud: { lead?: string; priceBasis: string; options: CloudOption[]; notes: string[]; allInNote: string };
  sheetPdf?: string;
}
export interface Recipe {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  /** spec tiles; `backticks` in a value render as code chips */
  specs: { k: string; v: string }[];
  /** launch lines, shown as a code block; lines starting with # are comments */
  launch?: string;
  sections: { title: string; items: string[] }[];
  links?: { label: string; href: string }[];
}
export interface BuildsData {
  updated: string;
  priceNote: string;
  builds: Build[];
  recipes: Recipe[];
}
