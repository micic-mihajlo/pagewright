import {
  compactFooterText,
  findSection,
  getElementText,
  hashString,
  parseHtml,
  serializeHtml,
  shortenHeadline,
} from "./html";
import type { EditRoute, PatchApplyResult, PatchOperation, PatchPlan, SectionType } from "./types";

export function classifyInstruction(instruction: string): Pick<
  PatchPlan,
  | "route"
  | "confidence"
  | "targetSections"
  | "allowedChangeScope"
  | "modelCallNeeded"
  | "recommendedModelTier"
  | "reasoningSummary"
> {
  const normalized = instruction.trim().toLowerCase();

  if (!normalized) {
    return route("unsupported", 0.1, [], "none", "Empty instruction.", false, "none");
  }
  if (/\b(revert|undo|previous version|last version)\b/.test(normalized)) {
    return route("revert", 0.98, [], "version history only", "Deterministic revert.", false, "none");
  }
  if (/\?|\b(what|why|how|explain|describe)\b/.test(normalized) && !/\b(change|make|remove|shorten|rebuild)\b/.test(normalized)) {
    return route("question_only", 0.8, [], "chat response only", "Instruction is a question.", false, "none");
  }
  if (/\b(rebuild|redesign|modern|saas landing|regenerate)\b/.test(normalized)) {
    return route(
      "full_regeneration",
      0.72,
      [],
      "whole document",
      "Full regeneration is a provider-backed placeholder in this local slice.",
      true,
      "strong",
    );
  }
  if (/\b(background|color|theme|light blue)\b/.test(normalized)) {
    return route(
      "global_style_edit",
      0.88,
      [],
      "global CSS and body/root style only",
      "Visual style edit.",
      false,
      "cheap",
    );
  }
  if (/\b(footer)\b/.test(normalized) && /\b(shorten|smaller|simplify|condense)\b/.test(normalized)) {
    return route(
      "targeted_edit",
      0.94,
      ["footer"],
      "footer text and footer-related markup only",
      "Targeted footer edit.",
      false,
      "cheap",
    );
  }
  if (/\b(hero|headline|heading)\b/.test(normalized) && /\b(shorten|smaller|simplify|condense)\b/.test(normalized)) {
    return route(
      "content_edit",
      0.86,
      ["hero"],
      "hero headline text only",
      "Hero headline content edit.",
      false,
      "cheap",
    );
  }
  if (/\b(remove|delete|hide)\b/.test(normalized) && /\b(testimonial|reviews|quotes)\b/.test(normalized)) {
    return route(
      "targeted_edit",
      0.88,
      ["testimonials"],
      "testimonials section only",
      "Remove testimonials section.",
      false,
      "cheap",
    );
  }
  if (/\b(cta|button|call to action)\b/.test(normalized) && /\b(prominent|bigger|stronger|emphasize)\b/.test(normalized)) {
    return route(
      "targeted_edit",
      0.84,
      ["cta"],
      "CTA button/link styling only",
      "Make CTA more prominent.",
      false,
      "cheap",
    );
  }

  return route(
    "unsupported",
    0.42,
    [],
    "provider-backed freeform edit",
    "Sending this instruction to the server-side model patcher.",
    true,
    "strong",
  );
}

export function generatePatchPlan(html: string, instruction: string): PatchPlan {
  const decision = classifyInstruction(instruction);
  const document = parseHtml(html);
  const normalized = instruction.toLowerCase();
  const operations: PatchOperation[] = [];

  if (decision.route === "targeted_edit" && decision.targetSections.includes("footer")) {
    const footer = findSection(document, "footer");
    if (footer) {
      operations.push({
        operation: "replace_inner_html",
        selector: selectorForElement(footer),
        beforeHash: hashString(footer.innerHTML),
        payload: { html: buildCompactFooterHtml(footer) },
        reason: "Condense footer copy while preserving primary footer links.",
        expectedScope: "footer inner HTML",
        riskLevel: "medium",
      });
    }
  }

  if (decision.route === "global_style_edit") {
    const body = document.body;
    operations.push({
      operation: "set_attribute",
      selector: "body",
      beforeHash: hashString(body?.getAttribute("style") ?? ""),
      payload: {
        name: "style",
        value: mergeStyle(body?.getAttribute("style") ?? "", "background: #dff3ff; color: #10202b;"),
      },
      reason: normalized.includes("light blue")
        ? "Apply requested light blue page background."
        : "Apply requested background/theme change.",
      expectedScope: "body style",
      riskLevel: "low",
    });
  }

  if (decision.targetSections.includes("hero")) {
    const headline = document.querySelector("h1");
    if (headline) {
      operations.push({
        operation: "replace_text",
        selector: "h1",
        beforeHash: hashString(getElementText(headline)),
        payload: { text: shortenHeadline(getElementText(headline)) },
        reason: "Shorten hero headline.",
        expectedScope: "hero headline text",
        riskLevel: "low",
      });
    }
  }

  if (decision.targetSections.includes("testimonials")) {
    const testimonials = findSection(document, "testimonials");
    if (testimonials) {
      operations.push({
        operation: "remove_node",
        selector:
          "[data-section='testimonials'], .testimonials, #testimonials, section[class*='testimonial']",
        beforeHash: hashString(testimonials.outerHTML),
        payload: {},
        reason: "Remove testimonials section.",
        expectedScope: "testimonials section",
        riskLevel: "medium",
      });
    }
  }

  if (decision.targetSections.includes("cta")) {
    const cta = findSection(document, "cta") ?? document.querySelector("a, button");
    if (cta) {
      const ctaControl = cta.matches("a, button") ? cta : cta.querySelector("a, button") ?? cta;
      operations.push({
        operation: "add_class",
        selector: selectorForElement(ctaControl),
        beforeHash: hashString(ctaControl.outerHTML),
        payload: { className: "pagewright-cta-emphasis" },
        reason: "Increase CTA prominence.",
        expectedScope: "CTA link/button class",
        riskLevel: "low",
      });
      operations.push({
        operation: "add_css_rule",
        selector: "head",
        payload: {
          cssText:
            ".pagewright-cta-emphasis{display:inline-flex!important;align-items:center;justify-content:center;padding:0.9rem 1.25rem!important;border-radius:10px!important;background:#111827!important;color:#fff!important;font-weight:800!important;box-shadow:0 14px 34px rgba(17,24,39,.22)!important;transform:translateY(-1px);}",
        },
        reason: "Add local CTA emphasis style.",
        expectedScope: "head style tag",
        riskLevel: "low",
      });
    }
  }

  if (decision.route === "full_regeneration") {
    return { ...decision, operations };
  }

  return { ...decision, operations };
}

export function applyPatchPlan(html: string, plan: PatchPlan): PatchApplyResult {
  const document = parseHtml(html);
  const applied: PatchOperation[] = [];
  const skipped: PatchApplyResult["skipped"] = [];

  for (const operation of plan.operations) {
    const result = applyOperation(document, operation);
    if (result === true) {
      applied.push(operation);
    } else {
      skipped.push({ operation, reason: result });
    }
  }

  return {
    html: serializeHtml(document),
    applied,
    skipped,
  };
}

function applyOperation(document: Document, operation: PatchOperation): true | string {
  if (operation.operation === "add_css_rule") {
    const head = document.head ?? document.documentElement.querySelector("head");
    if (!head) return "Missing head element.";
    const style = document.createElement("style");
    style.setAttribute("data-pagewright", "true");
    style.textContent = operation.payload.cssText;
    head.appendChild(style);
    return true;
  }
  if (operation.operation === "update_css_rule") {
    return applyCssRuleOperation(document, operation.selector, operation.payload.cssText ?? "", "update");
  }
  if (operation.operation === "delete_css_rule") {
    return applyCssRuleOperation(document, operation.selector, "", "delete");
  }

  const element = document.querySelector(operation.selector);
  if (!element) {
    return `Target not found: ${operation.selector}`;
  }

  if (operation.beforeHash) {
    const currentHash = hashString(hashSubject(element, operation));
    if (currentHash !== operation.beforeHash) {
      return `before_hash mismatch for ${operation.selector}`;
    }
  }

  if (operation.operation === "replace_text") {
    element.textContent = operation.payload.text;
    return true;
  }
  if (operation.operation === "replace_inner_html") {
    element.innerHTML = operation.payload.html;
    return true;
  }
  if (operation.operation === "replace_node") {
    element.outerHTML = operation.payload.html;
    return true;
  }
  if (operation.operation === "insert_node_before") {
    element.insertAdjacentHTML("beforebegin", operation.payload.html);
    return true;
  }
  if (operation.operation === "insert_node_after") {
    element.insertAdjacentHTML("afterend", operation.payload.html);
    return true;
  }
  if (operation.operation === "set_attribute") {
    element.setAttribute(operation.payload.name, operation.payload.value);
    return true;
  }
  if (operation.operation === "remove_attribute") {
    element.removeAttribute(operation.payload.name);
    return true;
  }
  if (operation.operation === "remove_node") {
    element.remove();
    return true;
  }
  if (operation.operation === "add_class") {
    element.classList.add(operation.payload.className);
    return true;
  }
  if (operation.operation === "remove_class") {
    element.classList.remove(operation.payload.className);
    return true;
  }
  return "Unsupported operation.";
}

function hashSubject(element: Element, operation: PatchOperation): string {
  if (operation.operation === "replace_text") return getElementText(element);
  if (operation.operation === "replace_inner_html") return element.innerHTML;
  if (operation.operation === "set_attribute") return element.getAttribute(operation.payload.name) ?? "";
  if (operation.operation === "remove_attribute") return element.getAttribute(operation.payload.name) ?? "";
  return element.outerHTML;
}

function buildCompactFooterHtml(footer: Element): string {
  const compactText = escapeHtml(compactFooterText(getElementText(footer)));
  const links = Array.from(footer.querySelectorAll("a")).slice(0, 4);
  const linkHtml = links.length
    ? `<nav aria-label="Footer links">${links.map((link) => link.outerHTML).join(" ")}</nav>`
    : "";

  return `<p>${compactText}</p>${linkHtml}`;
}

function mergeStyle(existing: string, addition: string): string {
  const trimmed = existing.trim();
  return trimmed ? `${trimmed.replace(/;?$/, ";")} ${addition}` : addition;
}

function selectorForElement(element: Element): string {
  if (element.id) return `#${escapeCssIdentifier(element.id)}`;
  const className = Array.from(element.classList)[0];
  if (className) return `${element.tagName.toLowerCase()}.${escapeCssIdentifier(className)}`;
  return element.tagName.toLowerCase();
}

function applyCssRuleOperation(
  document: Document,
  selector: string,
  cssText: string,
  mode: "update" | "delete",
): true | string {
  const styles = Array.from(document.querySelectorAll("style"));

  for (const style of styles) {
    const text = style.textContent ?? "";
    const range = findCssRuleRange(text, selector);

    if (range) {
      style.textContent =
        mode === "delete"
          ? `${text.slice(0, range.start)}${text.slice(range.end)}`
          : `${text.slice(0, range.start)}${cssText}${text.slice(range.end)}`;
      return true;
    }
  }

  if (mode === "update") {
    const head = document.head ?? document.documentElement.querySelector("head");
    if (!head) return "Missing head element.";
    const style = document.createElement("style");
    style.setAttribute("data-pagewright", "true");
    style.textContent = cssText;
    head.appendChild(style);
    return true;
  }

  return `CSS rule not found: ${selector}`;
}

function findCssRuleRange(cssText: string, selector: string): { start: number; end: number } | null {
  const selectorIndex = cssText.toLowerCase().indexOf(selector.toLowerCase());
  if (selectorIndex === -1) {
    return null;
  }

  const ruleEnd = cssText.indexOf("}", selectorIndex);
  if (ruleEnd === -1) {
    return null;
  }

  return { start: selectorIndex, end: ruleEnd + 1 };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeCssIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function route(
  routeName: EditRoute,
  confidence: number,
  targetSections: SectionType[],
  allowedChangeScope: string,
  reasoningSummary: string,
  modelCallNeeded: boolean,
  recommendedModelTier: PatchPlan["recommendedModelTier"],
) {
  return {
    route: routeName,
    confidence,
    targetSections,
    allowedChangeScope,
    modelCallNeeded,
    recommendedModelTier,
    reasoningSummary,
  };
}
