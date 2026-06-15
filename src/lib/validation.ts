import { analyzeHtml, sectionHash } from "./html";
import type { PatchPlan, SectionType, ValidationCheck, ValidationResult, ValidationStatus } from "./types";

const COMMON_SCOPE_SECTIONS: SectionType[] = [
  "header",
  "nav",
  "hero",
  "main",
  "testimonials",
  "cta",
  "footer",
];

export function validateChange(beforeHtml: string, afterHtml: string, plan: PatchPlan): ValidationResult {
  const checks: ValidationCheck[] = [];
  checks.push(parseCheck(afterHtml));
  checks.push(operationCheck(plan));
  checks.push(cssCheck(afterHtml));
  checks.push(contentCheck(beforeHtml, afterHtml, plan));
  checks.push(scopeCheck(beforeHtml, afterHtml, plan));

  const status = combineStatus(checks.map((check) => check.status));
  return {
    status,
    summary:
      status === "passed"
        ? "Validation passed. The version can be saved."
        : status === "warning"
          ? "Validation passed with warnings. Review the diff before using this version."
          : "Validation failed. The generated output was not saved.",
    checks,
    contentPreservation: summarizeContentPreservation(beforeHtml, afterHtml),
  };
}

function parseCheck(html: string): ValidationCheck {
  try {
    const analysis = analyzeHtml(html);
    const basicIssues = basicHtmlIssues(html);

    if (basicIssues.length > 0) {
      return {
        name: "HTML parse",
        status: "failed",
        detail: basicIssues.join(" "),
      };
    }

    return {
      name: "HTML parse",
      status: analysis.byteSize > 0 ? "passed" : "failed",
      detail: `${analysis.byteSize.toLocaleString()} bytes parsed.`,
    };
  } catch (error) {
    return {
      name: "HTML parse",
      status: "failed",
      detail: error instanceof Error ? error.message : "Unable to parse HTML.",
    };
  }
}

function operationCheck(plan: PatchPlan): ValidationCheck {
  if (plan.route === "question_only" || plan.route === "unsupported") {
    return {
      name: "Patch operations",
      status: "warning",
      detail: "No versioned edit should be created for this route.",
    };
  }
  if (plan.route === "full_regeneration" && plan.operations.length === 0) {
    return {
      name: "Patch operations",
      status: "warning",
      detail: "Full regeneration is a provider-seam placeholder in this slice.",
    };
  }
  if (plan.modelCallNeeded) {
    return {
      name: "Provider edit",
      status: "passed",
      detail: "The edit came from the server-side model patcher and will be validated before saving.",
    };
  }
  if (plan.operations.length === 0 && plan.route !== "revert") {
    return {
      name: "Patch operations",
      status: "failed",
      detail: "No patch operations were generated.",
    };
  }
  return {
    name: "Patch operations",
    status: "passed",
    detail: `${plan.operations.length} operation${plan.operations.length === 1 ? "" : "s"} generated.`,
  };
}

function cssCheck(html: string): ValidationCheck {
  const styleBlocks = Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi));
  const unbalanced = styleBlocks.some((match) => braceBalance(match[1] ?? "") !== 0);

  if (unbalanced) {
    return {
      name: "CSS sanity",
      status: "failed",
      detail: "A style block has unbalanced braces.",
    };
  }

  if (/url\s*\(\s*javascript:/i.test(html)) {
    return {
      name: "CSS sanity",
      status: "failed",
      detail: "A CSS rule contains a javascript: URL.",
    };
  }

  return {
    name: "CSS sanity",
    status: "passed",
    detail: `${styleBlocks.length} style block${styleBlocks.length === 1 ? "" : "s"} checked.`,
  };
}

function contentCheck(beforeHtml: string, afterHtml: string, plan: PatchPlan): ValidationCheck {
  const before = analyzeHtml(beforeHtml).contentInventory.filter((block) =>
    shouldPreserveBlock(block.kind, plan),
  );
  const afterInventory = analyzeHtml(afterHtml).contentInventory;
  const afterText = afterInventory.map((block) => block.text).join("\n");
  const preserved = before.filter((block) => afterText.includes(block.text)).length;
  const ratio = before.length === 0 ? 1 : preserved / before.length;

  if (plan.modelCallNeeded) {
    return {
      name: "Content inventory",
      status: afterInventory.length === 0 ? "failed" : ratio >= 0.85 ? "passed" : "warning",
      detail:
        ratio >= 0.85
          ? `${preserved}/${before.length} tracked blocks preserved.`
          : `${preserved}/${before.length} original exact blocks preserved; provider edit changed copy, so review the diff.`,
    };
  }

  if (plan.route === "full_regeneration") {
    return {
      name: "Content inventory",
      status: ratio >= 0.5 ? "warning" : "failed",
      detail: `${preserved}/${before.length} tracked blocks preserved after presentation regeneration.`,
    };
  }

  return {
    name: "Content inventory",
    status: ratio >= 0.85 ? "passed" : ratio >= 0.65 ? "warning" : "failed",
    detail: `${preserved}/${before.length} tracked blocks preserved.`,
  };
}

function scopeCheck(beforeHtml: string, afterHtml: string, plan: PatchPlan): ValidationCheck {
  if (plan.route === "global_style_edit") {
    const beforeWithoutStyles = beforeHtml.replace(/style="[^"]*"/g, "");
    const afterWithoutStyles = afterHtml
      .replace(/style="[^"]*"/g, "")
      .replace(/<style data-pagewright="true">[\s\S]*?<\/style>/g, "");
    return {
      name: "Scope",
      status: beforeWithoutStyles === afterWithoutStyles ? "passed" : "warning",
      detail: "Global style edits should avoid content changes.",
    };
  }

  if (plan.route === "targeted_edit" || plan.route === "content_edit") {
    const watched = COMMON_SCOPE_SECTIONS.filter((section) =>
      shouldWatchSection(section, plan.targetSections),
    );
    const changed = watched.filter((section) => sectionHash(beforeHtml, section) !== sectionHash(afterHtml, section));
    return {
      name: "Scope",
      status: changed.length === 0 ? "passed" : "warning",
      detail:
        changed.length === 0
          ? "Unrelated tracked sections are unchanged."
          : `Potential unrelated changes: ${changed.join(", ")}.`,
    };
  }

  return {
    name: "Scope",
    status: "passed",
    detail: plan.allowedChangeScope,
  };
}

function summarizeContentPreservation(beforeHtml: string, afterHtml: string): string {
  const before = analyzeHtml(beforeHtml).contentInventory.length;
  const after = analyzeHtml(afterHtml).contentInventory.length;
  return `${after}/${before} tracked content blocks present after edit.`;
}

function combineStatus(statuses: ValidationStatus[]): ValidationStatus {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("warning")) return "warning";
  return "passed";
}

function basicHtmlIssues(html: string): string[] {
  const issues: string[] = [];
  const trimmed = html.trim();

  if (trimmed.length === 0) {
    issues.push("HTML is empty.");
  }

  if (!/<[a-zA-Z][\w:-]*(\s|>|\/>)/.test(html)) {
    issues.push("No HTML elements were found.");
  }

  if ((html.match(/<body\b/gi)?.length ?? 0) > 1) {
    issues.push("Multiple body tags were found.");
  }

  return issues;
}

function shouldPreserveBlock(kind: SectionType, plan: PatchPlan): boolean {
  if (plan.route === "full_regeneration") {
    return true;
  }

  return !isAllowedTargetChange(kind, plan.targetSections);
}

function shouldWatchSection(section: SectionType, targets: SectionType[]): boolean {
  return !isAllowedTargetChange(section, targets);
}

function isAllowedTargetChange(section: SectionType, targets: SectionType[]): boolean {
  if (targets.includes(section)) {
    return true;
  }

  if (section === "main" && targets.length > 0) {
    return true;
  }

  if (section === "header" && (targets.includes("nav") || targets.includes("hero"))) {
    return true;
  }

  return false;
}

function braceBalance(css: string): number {
  let balance = 0;

  for (const character of css) {
    if (character === "{") {
      balance += 1;
    } else if (character === "}") {
      balance -= 1;
    }
  }

  return balance;
}
