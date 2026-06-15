export type EditRoute =
  | "revert"
  | "targeted_edit"
  | "global_style_edit"
  | "content_edit"
  | "section_regeneration"
  | "full_regeneration"
  | "question_only"
  | "unsupported";

export type ValidationStatus = "passed" | "warning" | "failed";

export type SectionType =
  | "header"
  | "nav"
  | "navigation"
  | "hero"
  | "main"
  | "features"
  | "testimonials"
  | "cta"
  | "footer"
  | "unknown";

export type ContentBlock = {
  id: string;
  kind: SectionType;
  label: string;
  text: string;
  hash: string;
};

export type SectionSummary = {
  id: string;
  type: SectionType;
  selector: string;
  label: string;
  textSummary: string;
  htmlHash: string;
  textHash: string;
  byteSize: number;
};

export type BrandSpec = {
  colors: string[];
  fonts: string[];
  radiusHints: string[];
  tone: string;
};

export type HtmlAnalysis = {
  htmlHash: string;
  byteSize: number;
  structuralSummary: string;
  contentInventory: ContentBlock[];
  brandSpec: BrandSpec;
  sections: SectionSummary[];
};

export type PatchOperation =
  | {
      operation: "replace_text";
      selector: string;
      beforeHash?: string;
      payload: { text: string };
      reason: string;
      expectedScope: string;
      riskLevel: "low" | "medium" | "high";
    }
  | {
      operation: "replace_inner_html";
      selector: string;
      beforeHash?: string;
      payload: { html: string };
      reason: string;
      expectedScope: string;
      riskLevel: "low" | "medium" | "high";
    }
  | {
      operation: "replace_node";
      selector: string;
      beforeHash?: string;
      payload: { html: string };
      reason: string;
      expectedScope: string;
      riskLevel: "low" | "medium" | "high";
    }
  | {
      operation: "insert_node_before" | "insert_node_after";
      selector: string;
      beforeHash?: string;
      payload: { html: string };
      reason: string;
      expectedScope: string;
      riskLevel: "low" | "medium" | "high";
    }
  | {
      operation: "set_attribute";
      selector: string;
      beforeHash?: string;
      payload: { name: string; value: string };
      reason: string;
      expectedScope: string;
      riskLevel: "low" | "medium" | "high";
    }
  | {
      operation: "remove_attribute";
      selector: string;
      beforeHash?: string;
      payload: { name: string };
      reason: string;
      expectedScope: string;
      riskLevel: "low" | "medium" | "high";
    }
  | {
      operation: "remove_node";
      selector: string;
      beforeHash?: string;
      payload: Record<string, never>;
      reason: string;
      expectedScope: string;
      riskLevel: "low" | "medium" | "high";
    }
  | {
      operation: "add_class";
      selector: string;
      beforeHash?: string;
      payload: { className: string };
      reason: string;
      expectedScope: string;
      riskLevel: "low" | "medium" | "high";
    }
  | {
      operation: "remove_class";
      selector: string;
      beforeHash?: string;
      payload: { className: string };
      reason: string;
      expectedScope: string;
      riskLevel: "low" | "medium" | "high";
    }
  | {
      operation: "add_css_rule";
      selector: "head";
      beforeHash?: string;
      payload: { cssText: string };
      reason: string;
      expectedScope: string;
      riskLevel: "low" | "medium" | "high";
    }
  | {
      operation: "update_css_rule" | "delete_css_rule";
      selector: string;
      beforeHash?: string;
      payload: { cssText?: string };
      reason: string;
      expectedScope: string;
      riskLevel: "low" | "medium" | "high";
    };

export type PatchPlan = {
  route: EditRoute;
  confidence: number;
  targetSections: SectionType[];
  allowedChangeScope: string;
  modelCallNeeded: boolean;
  recommendedModelTier: "none" | "cheap" | "strong";
  reasoningSummary: string;
  operations: PatchOperation[];
};

export type PatchApplyResult = {
  html: string;
  applied: PatchOperation[];
  skipped: Array<{ operation: PatchOperation; reason: string }>;
};

export type ValidationCheck = {
  name: string;
  status: ValidationStatus;
  detail: string;
};

export type ValidationResult = {
  status: ValidationStatus;
  summary: string;
  checks: ValidationCheck[];
  contentPreservation: string;
};
