import type {
  BrandSpec,
  ContentBlock,
  HtmlAnalysis,
  SectionSummary,
  SectionType,
} from "./types";

const SECTION_SELECTORS: Array<{ type: SectionType; selector: string }> = [
  { type: "header", selector: "header" },
  { type: "nav", selector: "nav" },
  { type: "hero", selector: "[data-section='hero'], .hero, #hero, main section:first-of-type" },
  {
    type: "features",
    selector: "[data-section='features'], .features, #features, section[class*='feature']",
  },
  {
    type: "testimonials",
    selector:
      "[data-section='testimonials'], .testimonials, #testimonials, section[class*='testimonial']",
  },
  { type: "cta", selector: "[data-section='cta'], .cta, #cta, section[class*='cta']" },
  { type: "main", selector: "main" },
  { type: "footer", selector: "footer, [role='contentinfo'], .footer, #footer" },
];

export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function htmlByteSize(html: string): number {
  return new TextEncoder().encode(html).byteLength;
}

export function byteSize(html: string): number {
  return htmlByteSize(html);
}

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

export function serializeHtml(document: Document): string {
  const doctype = document.doctype ? "<!doctype html>\n" : "";
  return `${doctype}${document.documentElement.outerHTML}`;
}

export function summarizeText(text: string, maxLength = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

export function getElementText(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

export function findSection(document: Document, type: SectionType): Element | null {
  const direct = SECTION_SELECTORS.find((entry) => entry.type === type);
  if (direct) {
    const found = document.querySelector(direct.selector);
    if (found) {
      return found;
    }
  }

  if (type === "hero") {
    return document.querySelector("h1")?.closest("section, header, main, div") ?? null;
  }

  if (type === "cta") {
    return (
      Array.from(document.querySelectorAll("a, button")).find((element) =>
        /start|try|buy|book|contact|get|demo|sign/i.test(getElementText(element)),
      )?.closest("section, div, main") ?? null
    );
  }

  return null;
}

export function sectionHash(html: string, type: SectionType): string {
  const document = parseHtml(html);
  const section = findSection(document, type);
  return hashString(section?.outerHTML ?? "");
}

export function extractSections(html: string): SectionSummary[] {
  const document = parseHtml(html);
  const seen = new Set<Element>();
  const sections: SectionSummary[] = [];

  for (const entry of SECTION_SELECTORS) {
    const element = findSection(document, entry.type);
    if (!element || seen.has(element)) {
      continue;
    }
    seen.add(element);
    const htmlFragment = element.outerHTML;
    const text = getElementText(element);
    sections.push({
      id: `${entry.type}-${sections.length + 1}`,
      type: entry.type,
      selector: entry.selector,
      label: inferSectionLabel(element, entry.type),
      textSummary: summarizeText(text),
      htmlHash: hashString(htmlFragment),
      textHash: hashString(text),
      byteSize: htmlByteSize(htmlFragment),
    });
  }

  if (sections.length === 0 && document.body) {
    const text = getElementText(document.body);
    sections.push({
      id: "main-1",
      type: "main",
      selector: "body",
      label: "Body",
      textSummary: summarizeText(text),
      htmlHash: hashString(document.body.outerHTML),
      textHash: hashString(text),
      byteSize: htmlByteSize(document.body.outerHTML),
    });
  }

  return sections;
}

export function analyzeHtml(html: string): HtmlAnalysis {
  const document = parseHtml(html);
  const sections = extractSections(html);
  const contentInventory = buildContentInventory(document);
  const brandSpec = extractBrandSpec(html);
  const title = document.querySelector("title")?.textContent?.trim();
  const sectionList = sections.map((section) => `${section.type}:${section.label}`).join(", ");

  return {
    htmlHash: hashString(html),
    byteSize: htmlByteSize(html),
    structuralSummary: `${title ? `Title "${title}". ` : ""}${sections.length} indexed sections: ${
      sectionList || "body"
    }. ${contentInventory.length} content blocks preserved.`,
    contentInventory,
    brandSpec,
    sections,
  };
}

export function compactFooterText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Thanks for visiting.";
  }
  const copyright = normalized.match(/(?:©|\(c\)|copyright)\s*[^.|\n]+/i)?.[0];
  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0];
  const base = copyright ?? firstSentence ?? normalized;
  return summarizeText(base, 140);
}

export function shortenHeadline(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= 8) {
    return text.trim();
  }
  return words.slice(0, 8).join(" ");
}

function buildContentInventory(document: Document): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const headingElements = Array.from(document.querySelectorAll("h1, h2, h3"));
  headingElements.slice(0, 40).forEach((element, index) => {
    const text = getElementText(element);
    if (text) {
      blocks.push({
        id: `heading-${index + 1}`,
        kind: inferElementSection(element),
        label: element.tagName.toLowerCase(),
        text,
        hash: hashString(text),
      });
    }
  });

  Array.from(document.querySelectorAll("p, li, a, button"))
    .map((element) => ({ element, text: getElementText(element) }))
    .filter((entry) => entry.text.length >= 24)
    .slice(0, 80)
    .forEach((entry, index) => {
      blocks.push({
        id: `copy-${index + 1}`,
        kind: inferElementSection(entry.element),
        label: entry.element.tagName.toLowerCase(),
        text: entry.text,
        hash: hashString(entry.text),
      });
    });

  return blocks;
}

function extractBrandSpec(html: string): BrandSpec {
  const colors = uniqueMatches(html, /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g).slice(0, 12);
  const fonts = uniqueMatches(html, /font-family\s*:\s*([^;}"']+)/gi)
    .map((value) => value.replace(/^font-family\s*:\s*/i, "").trim())
    .slice(0, 6);
  const radiusHints = uniqueMatches(html, /border-radius\s*:\s*([^;}"']+)/gi)
    .map((value) => value.replace(/^border-radius\s*:\s*/i, "").trim())
    .slice(0, 6);

  return {
    colors,
    fonts,
    radiusHints,
    tone: colors.length > 6 ? "visually rich" : "restrained",
  };
}

function uniqueMatches(input: string, pattern: RegExp): string[] {
  return Array.from(new Set(input.match(pattern) ?? []));
}

function inferSectionLabel(element: Element, fallback: SectionType): string {
  const heading = element.querySelector("h1, h2, h3");
  const label = heading ? getElementText(heading) : element.getAttribute("aria-label");
  return summarizeText(label || fallback, 80);
}

function inferElementSection(element: Element): SectionType {
  const closest = element.closest(
    "footer, header, nav, main, section, [data-section], .hero, .features, .testimonials, .cta",
  );
  if (!closest) {
    return "unknown";
  }
  const signature = `${closest.tagName} ${closest.id} ${closest.className} ${
    closest.getAttribute("data-section") ?? ""
  }`.toLowerCase();
  if (signature.includes("footer")) return "footer";
  if (signature.includes("header")) return "header";
  if (signature.includes("nav")) return "nav";
  if (signature.includes("hero")) return "hero";
  if (signature.includes("testimonial")) return "testimonials";
  if (signature.includes("feature")) return "features";
  if (signature.includes("cta")) return "cta";
  if (signature.includes("main")) return "main";
  return "unknown";
}
