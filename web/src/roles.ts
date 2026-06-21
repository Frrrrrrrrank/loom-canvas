import type { NodeRole } from "./api";

export interface RoleMeta {
  label: string;
  icon: string;
  tint: string;
  blurb: string;
}

export const ROLES: Record<NodeRole, RoleMeta> = {
  core_question: {
    label: "Core Question",
    icon: "🎯",
    tint: "#7c6cff",
    blurb: "The central question + boundary (one per study)",
  },
  issue: {
    label: "Issue",
    icon: "❓",
    tint: "#ecb22e",
    blurb: "An issue / hypothesis to test",
  },
  research: {
    label: "Research",
    icon: "🔬",
    tint: "#36c5f0",
    blurb: "A (deep) research task that gathers evidence",
  },
  synthesis: {
    label: "Synthesis",
    icon: "🧩",
    tint: "#2eb67d",
    blurb: "Distill connected research into a storyline",
  },
  output: {
    label: "Output",
    icon: "📊",
    tint: "#e01e5a",
    blurb: "The deliverable / visualization (deck)",
  },
  note: { label: "Note", icon: "📝", tint: "#8a8aa2", blurb: "Free-form note" },
};

export const ROLE_ORDER: NodeRole[] = [
  "core_question",
  "issue",
  "research",
  "synthesis",
  "output",
  "note",
];

export function roleMeta(role: string | undefined): RoleMeta {
  return ROLES[(role as NodeRole) ?? "note"] ?? ROLES.note;
}

// human label for an edge relation
export const RELATION_LABEL: Record<string, string> = {
  decompose: "breaks down",
  support: "supports",
  distill: "distills",
  visualize: "visualizes",
  evidence: "evidence",
  relate: "",
};

// the per-role structured fields shown/edited on a card
export const ROLE_FIELDS: Partial<Record<NodeRole, { key: string; label: string; long?: boolean }[]>> = {
  core_question: [
    { key: "basic_question", label: "Basic question", long: true },
    { key: "context", label: "Context", long: true },
    { key: "criteria_for_success", label: "Criteria for success", long: true },
    { key: "scope", label: "Scope", long: true },
  ],
  issue: [
    { key: "issue", label: "Issue", long: true },
    { key: "hypothesis", label: "Hypothesis", long: true },
  ],
  research: [{ key: "question", label: "Research question", long: true }],
};

export const ISSUE_STATUS: Record<string, { label: string; cls: string }> = {
  untested: { label: "untested", cls: "untested" },
  supported: { label: "supported", cls: "supported" },
  challenged: { label: "challenged", cls: "challenged" },
  mixed: { label: "mixed", cls: "mixed" },
};
