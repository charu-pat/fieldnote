export type ItemType = "skill" | "statement";
export type PlacementTag = { sectionTitle: string; subsectionTitle?: string };
export type LibraryItem = { id: string; type: ItemType; text: string; placement?: PlacementTag };
export type CVItem = { id: string; sourceItemId: string | null; type: ItemType; text: string; subsectionId: string | null };
export type Subsection = { id: string; title: string; dates: string };
export type Section = { id: string; title: string; items: CVItem[]; subsections: Subsection[] };
export type CVData = {
  header: { name: string; title: string; email: string; phone: string; location: string; links: string };
  sections: Section[];
  pageSize: "A4" | "Letter";
};
export type SavedData = { collection: LibraryItem[]; cv: CVData };

export const STORAGE_KEY = "fieldnote-cv-v1";
export const SKILL_SEPARATOR = "  ·  ";
export const CV_DOCUMENT = {
  marginMm: 19,
  topOffsetMm: 3,
  font: "Arial",
  nameSize: 24,
  titleSize: 12,
  contactSize: 9,
  sectionSize: 12,
  subsectionSize: 10,
  itemSize: 10,
};
export const defaultSections = (): Section[] => [
  { id: "summary", title: "Profile / Summary", items: [], subsections: [] },
  { id: "skills", title: "Skills", items: [], subsections: [] },
  { id: "experience", title: "Experience", items: [], subsections: [] },
  { id: "education", title: "Education", items: [], subsections: [] },
  { id: "other", title: "Other", items: [], subsections: [] },
];
export const initialCV = (): CVData => ({
  header: { name: "", title: "", email: "", phone: "", location: "", links: "" },
  sections: defaultSections(),
  pageSize: "A4",
});
/** Section and subsection names match ignoring case and surrounding whitespace. */
export const sameTitle = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export function insertIntoGroup(items: CVItem[], subsectionId: string | null, index: number, item: CVItem) {
  const group = items.filter((entry) => entry.subsectionId === subsectionId);
  if (index >= group.length) return [...items, item];
  const at = items.indexOf(group[Math.max(0, index)]);
  return [...items.slice(0, at), item, ...items.slice(at)];
}

export type DropTarget = { sectionId: string; subsectionId: string | null; index: number; noop: boolean };
export type MarkerPosition = "before" | "after" | null;

export function normalizeCV(cv: CVData): CVData {
  return {
    ...cv,
    sections: cv.sections.map((section) => ({
      ...section,
      items: (section.items ?? []).map((item) => ({ ...item, subsectionId: item.subsectionId ?? null })),
      subsections: (section.subsections ?? []).map((subsection) => ({ ...subsection, dates: subsection.dates ?? "" })),
    })),
  };
}

export function ensurePlacement(cv: CVData, placement: PlacementTag) {
  const sectionName = placement.sectionTitle.trim();
  let sections = [...cv.sections];
  let section = sections.find((entry) => sameTitle(entry.title, sectionName));
  if (!section) {
    section = { id: crypto.randomUUID(), title: sectionName, items: [], subsections: [] };
    sections = [...sections, section];
  }
  let subsection: Subsection | undefined;
  const subsectionName = placement.subsectionTitle?.trim();
  if (subsectionName) {
    subsection = section.subsections.find((entry) => sameTitle(entry.title, subsectionName));
    if (!subsection) {
      subsection = { id: crypto.randomUUID(), title: subsectionName, dates: "" };
      section = { ...section, subsections: [...section.subsections, subsection] };
      sections = sections.map((entry) => entry.id === section!.id ? section! : entry);
    }
  }
  return {
    cv: { ...cv, sections },
    sectionId: section.id,
    subsectionId: subsection?.id ?? null,
  };
}

export function loadSaved(): SavedData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedData;
      if (Array.isArray(parsed.collection) && parsed.cv?.header && Array.isArray(parsed.cv.sections)) {
        return { ...parsed, cv: normalizeCV(parsed.cv) };
      }
    }
  } catch (error) {
    console.error("Could not load the saved CV workspace.", error);
  }
  return { collection: [], cv: initialCV() };
}

export function fileName(name: string, extension: string) {
  const safeName = name.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${safeName || "My"}-CV.${extension}`;
}

// Logical CV content in export order. The paginated preview, PDF and DOCX are all built from this,
// so wording and order stay identical across outputs.
export type OutlineEntry =
  | { kind: "section"; text: string; isFirst: boolean; hasContent: boolean }
  | { kind: "subsection"; text: string; hasContent: boolean }
  | { kind: "statement"; text: string }
  | { kind: "skills"; skills: string[] };

export const contactLine = (header: CVData["header"]) =>
  [header.email, header.phone, header.location, header.links].filter(Boolean).join("  |  ");

export function cvOutline(cv: CVData): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  const pushItems = (items: CVItem[]) => {
    let skillRun: string[] = [];
    const flushSkills = () => {
      if (skillRun.length) outline.push({ kind: "skills", skills: skillRun });
      skillRun = [];
    };
    items.forEach((item) => {
      if (item.type === "skill") skillRun.push(item.text.trim().replace(/\s+/g, " "));
      else {
        flushSkills();
        outline.push({ kind: "statement", text: item.text });
      }
    });
    flushSkills();
  };
  let sectionCount = 0;
  cv.sections.forEach((section) => {
    if (!section.title.trim()) return;
    const { top, bySubsection } = groupSectionItems(section);
    outline.push({
      kind: "section",
      text: section.title,
      isFirst: sectionCount === 0,
      hasContent: top.length > 0 || section.subsections.some((sub) => bySubsection.get(sub.id)!.length > 0),
    });
    sectionCount += 1;
    pushItems(top);
    section.subsections.forEach((subsection) => {
      const items = bySubsection.get(subsection.id)!;
      outline.push({
        kind: "subsection",
        text: `${subsection.title}${subsection.dates ? `  |  ${subsection.dates}` : ""}`,
        hasContent: items.length > 0,
      });
      pushItems(items);
    });
  });
  return outline;
}

/** Splits a section's items, in one pass, into top-level items and items per subsection (display order). */
export function groupSectionItems(section: Section) {
  const top: CVItem[] = [];
  const bySubsection = new Map<string, CVItem[]>(section.subsections.map((subsection) => [subsection.id, []]));
  for (const item of section.items) {
    if (!item.subsectionId) top.push(item);
    else bySubsection.get(item.subsectionId)?.push(item);
  }
  return { top, bySubsection };
}

export function placementLabel(cv: CVData, sectionId: string, subsectionId: string | null) {
  const section = cv.sections.find((entry) => entry.id === sectionId);
  const subsection = section?.subsections.find((entry) => entry.id === subsectionId);
  return `${section?.title ?? "CV"}${subsection ? ` / ${subsection.title}` : ""}`;
}

const groupItems = (section: Section | undefined, subsectionId: string | null) =>
  section?.items.filter((item) => item.subsectionId === subsectionId) ?? [];

/** Adds a copy of a collection item at a position within a section or subsection (default: the end). */
export function addCopyToCV(
  cv: CVData,
  library: LibraryItem,
  sectionId: string,
  subsectionId: string | null = null,
  index = Infinity,
  id: string = crypto.randomUUID(),
): { cv: CVData; position: number } {
  const copy: CVItem = { id, sourceItemId: library.id, type: library.type, text: library.text, subsectionId };
  const position = Math.min(index, groupItems(cv.sections.find((section) => section.id === sectionId), subsectionId).length) + 1;
  return {
    cv: {
      ...cv,
      sections: cv.sections.map((section) => section.id === sectionId
        ? { ...section, items: insertIntoGroup(section.items, subsectionId, index, copy) }
        : section),
    },
    position,
  };
}

/** Moves a CV item to a drop target. The target index counts gaps in the group as displayed, including the moved item. */
export function moveCVItem(cv: CVData, itemId: string, target: Pick<DropTarget, "sectionId" | "subsectionId" | "index">) {
  const source = cv.sections.find((section) => section.items.some((item) => item.id === itemId));
  const moved = source?.items.find((item) => item.id === itemId);
  if (!source || !moved || !cv.sections.some((section) => section.id === target.sectionId)) return null;
  let index = target.index;
  if (source.id === target.sectionId && moved.subsectionId === target.subsectionId) {
    const from = groupItems(source, target.subsectionId).findIndex((item) => item.id === itemId);
    if (from < index) index -= 1;
  }
  const next: CVData = {
    ...cv,
    sections: cv.sections.map((section) => {
      let items = section.items;
      if (section.id === source.id) items = items.filter((item) => item.id !== itemId);
      if (section.id === target.sectionId) items = insertIntoGroup(items, target.subsectionId, index, { ...moved, subsectionId: target.subsectionId });
      return items === section.items ? section : { ...section, items };
    }),
  };
  return { cv: next, position: Math.min(index, groupItems(next.sections.find((section) => section.id === target.sectionId), target.subsectionId).length - 1) + 1 };
}

type Point = { x: number; y: number };
type Box = { left: number; top: number; width: number; height: number; right: number; bottom: number };

/**
 * Where a drop lands within a group, as a gap index (0 = before the first item, group.length = the end).
 * Pointer drags use the item under the pointer: left/right halves for skill chips, top/bottom halves for
 * statements. Keyboard steps onto a neighbouring item take its place.
 */
export function resolveInsertion(group: CVItem[], options: {
  overId?: string | null;
  activeId?: string | null;
  keyboard?: boolean;
  pointer?: Point | null;
  overRect?: Box | null;
}): { index: number; noop: boolean } {
  const activeIndex = options.activeId ? group.findIndex((item) => item.id === options.activeId) : -1;
  const overIndex = options.overId ? group.findIndex((item) => item.id === options.overId) : -1;
  let index = group.length;
  if (overIndex >= 0) {
    const { pointer, overRect: rect } = options;
    if (activeIndex >= 0 && options.keyboard) index = overIndex > activeIndex ? overIndex + 1 : overIndex;
    else if (pointer && rect) {
      const inline = group[overIndex].type === "skill";
      const after = pointer.y > rect.bottom ? true
        : pointer.y < rect.top ? false
        : inline ? pointer.x > rect.left + rect.width / 2 : pointer.y > rect.top + rect.height / 2;
      index = overIndex + (after ? 1 : 0);
    } else index = overIndex;
  }
  return { index, noop: activeIndex >= 0 && (index === activeIndex || index === activeIndex + 1) };
}

/** Which side of an item the insertion marker is drawn on, if any. */
export function markerPosition(target: DropTarget | null, sectionId: string, subsectionId: string | null, itemIndex: number, groupSize: number): MarkerPosition {
  if (!target || target.noop || target.sectionId !== sectionId || target.subsectionId !== subsectionId) return null;
  if (target.index === itemIndex) return "before";
  return target.index >= groupSize && itemIndex === groupSize - 1 ? "after" : null;
}
