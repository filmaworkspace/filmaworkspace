import type { Timestamp } from "firebase/firestore";

export const GUIDE_CATEGORIES = [
  "General",
  "Contabilidad",
  "Team",
  "Configuración",
] as const;

export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];

export type GuideBlock =
  | { id: string; type: "heading"; level: 2 | 3; text: string }
  | { id: string; type: "paragraph"; html: string }
  | { id: string; type: "image"; url: string; caption: string }
  | { id: string; type: "link"; url: string; label: string };

export interface Guide {
  id: string;
  title: string;
  slug: string;
  summary: string;
  category: GuideCategory;
  coverImageUrl: string;
  blocks: GuideBlock[];
  published: boolean;
  views: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  createdBy: string;
  createdByName: string;
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Sanitización defensiva del HTML generado por el editor (contentEditable +
// execCommand): solo deja pasar las etiquetas/atributos que el editor puede
// producir realmente, para evitar que un <script> o un atributo on* se cuele
// si el HTML se ha manipulado fuera del editor antes de guardarse.
export function sanitizeInlineHtml(html: string): string {
  const div = typeof document !== "undefined" ? document.createElement("div") : null;
  if (!div) return html;
  div.innerHTML = html;

  const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "A", "BR", "DIV", "SPAN"]);

  const clean = (node: Node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          const text = document.createTextNode(el.textContent || "");
          node.replaceChild(text, el);
          return;
        }
        Array.from(el.attributes).forEach((attr) => {
          if (attr.name === "href" && el.tagName === "A") {
            if (!/^https?:\/\//i.test(attr.value) && !attr.value.startsWith("mailto:")) {
              el.removeAttribute("href");
            }
            return;
          }
          el.removeAttribute(attr.name);
        });
        clean(el);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        node.removeChild(child);
      }
    });
  };

  clean(div);
  return div.innerHTML;
}

export function newBlockId(): string {
  return Math.random().toString(36).slice(2, 10);
}
