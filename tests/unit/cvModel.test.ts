import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addCopyToCV,
  contactLine,
  cvOutline,
  ensurePlacement,
  fileName,
  initialCV,
  insertIntoGroup,
  loadSaved,
  markerPosition,
  moveCVItem,
  normalizeCV,
  placementLabel,
  resolveInsertion,
  sameTitle,
  STORAGE_KEY,
  type CVData,
  type DropTarget,
  type LibraryItem,
} from "../../src/cvModel";
import { sampleCV, savedData, skill, statement } from "../fixtures/cv";

const texts = (cv: CVData, sectionId: string, subsectionId: string | null = null) =>
  cv.sections.find((section) => section.id === sectionId)!.items
    .filter((item) => item.subsectionId === subsectionId)
    .map((item) => item.text);

describe("defaults", () => {
  it("starts with the five required sections in order, on A4 (D-3, E-6)", () => {
    const cv = initialCV();
    expect(cv.sections.map((section) => section.title)).toEqual(["Profile / Summary", "Skills", "Experience", "Education", "Other"]);
    expect(cv.pageSize).toBe("A4");
    expect(cv.sections.every((section) => section.items.length === 0 && section.subsections.length === 0)).toBe(true);
  });

  it("matches titles ignoring case and surrounding whitespace", () => {
    expect(sameTitle("  Experience ", "experience")).toBe(true);
    expect(sameTitle("Experience", "Experiences")).toBe(false);
  });
});

describe("fileName (E-7)", () => {
  it.each([
    ["Jane Doe", "pdf", "Jane-Doe-CV.pdf"],
    ["  Jane   Doe  ", "docx", "Jane-Doe-CV.docx"],
    ["Zoë O'Brien-Smith", "pdf", "Zo-O-Brien-Smith-CV.pdf"],
    ["", "json", "My-CV.json"],
    ["!!!", "pdf", "My-CV.pdf"],
  ])("%j -> %s", (name, extension, expected) => {
    expect(fileName(name, extension)).toBe(expected);
  });
});

describe("persistence (C-5, section 5)", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts with an empty collection and the default CV when nothing is saved", () => {
    const loaded = loadSaved();
    expect(loaded.collection).toEqual([]);
    expect(loaded.cv).toEqual(initialCV());
  });

  it("restores saved data", () => {
    store.set(STORAGE_KEY, JSON.stringify(savedData()));
    const loaded = loadSaved();
    expect(loaded.collection.map((item) => item.text)).toEqual(["NewSkill", "NewStatement"]);
    expect(loaded.cv.header.name).toBe("Jane Doe");
  });

  it("ignores corrupt data instead of crashing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    store.set(STORAGE_KEY, "{not json");
    expect(loadSaved()).toEqual({ collection: [], cv: initialCV() });
    store.set(STORAGE_KEY, JSON.stringify({ collection: "nope" }));
    expect(loadSaved()).toEqual({ collection: [], cv: initialCV() });
  });

  it("normalises older saves without subsections or dates", () => {
    const legacy = {
      header: sampleCV().header,
      pageSize: "A4",
      sections: [{ id: "x", title: "X", items: [{ id: "i", sourceItemId: null, type: "skill", text: "T" }] }],
    } as unknown as CVData;
    const cv = normalizeCV(legacy);
    expect(cv.sections[0].subsections).toEqual([]);
    expect(cv.sections[0].items[0].subsectionId).toBeNull();
    const withSubsection = normalizeCV({ ...legacy, sections: [{ id: "y", title: "Y", items: [], subsections: [{ id: "s", title: "S" }] }] } as unknown as CVData);
    expect(withSubsection.sections[0].subsections[0].dates).toBe("");
  });
});

describe("insertIntoGroup", () => {
  const items = [statement("a", "A"), statement("x", "X", "sub"), statement("b", "B"), statement("y", "Y", "sub")];

  it("inserts before the item at the gap index within its group only", () => {
    const result = insertIntoGroup(items, null, 1, statement("n", "N"));
    expect(result.filter((item) => !item.subsectionId).map((item) => item.text)).toEqual(["A", "N", "B"]);
    expect(result.filter((item) => item.subsectionId === "sub").map((item) => item.text)).toEqual(["X", "Y"]);
  });

  it("inserts at the start and appends at or beyond the end", () => {
    expect(insertIntoGroup(items, "sub", 0, statement("n", "N", "sub")).filter((item) => item.subsectionId === "sub").map((item) => item.text)).toEqual(["N", "X", "Y"]);
    expect(insertIntoGroup(items, "sub", 2, statement("n", "N", "sub")).filter((item) => item.subsectionId === "sub").map((item) => item.text)).toEqual(["X", "Y", "N"]);
    expect(insertIntoGroup(items, null, Infinity, statement("n", "N")).at(-1)!.text).toBe("N");
  });

  it("does not mutate the original array", () => {
    const copy = [...items];
    insertIntoGroup(items, null, 0, statement("n", "N"));
    expect(items).toEqual(copy);
  });
});

describe("addCopyToCV (D-1, D-2)", () => {
  const library: LibraryItem = { id: "L1", type: "skill", text: "NewSkill" };

  it("adds an independent copy at the end by default", () => {
    const { cv, position } = addCopyToCV(sampleCV(), library, "skills", null, undefined, "copy-1");
    expect(texts(cv, "skills")).toEqual(["SkillA", "SkillB", "SkillC", "NewSkill"]);
    expect(position).toBe(4);
    const copy = cv.sections[1].items.at(-1)!;
    expect(copy).toEqual({ id: "copy-1", sourceItemId: "L1", type: "skill", text: "NewSkill", subsectionId: null });
  });

  it("inserts at a gap index and reports the 1-based position", () => {
    const { cv, position } = addCopyToCV(sampleCV(), library, "skills", null, 1);
    expect(texts(cv, "skills")).toEqual(["SkillA", "NewSkill", "SkillB", "SkillC"]);
    expect(position).toBe(2);
  });

  it("adds into a subsection", () => {
    const { cv, position } = addCopyToCV(sampleCV(), library, "experience", "acme", 0);
    expect(texts(cv, "experience", "acme")).toEqual(["NewSkill", "Acme one", "Python"]);
    expect(texts(cv, "experience")).toEqual(["Stmt one", "Stmt two", "Stmt three"]);
    expect(position).toBe(1);
  });

  it("allows the same item to be added more than once, with distinct ids", () => {
    const once = addCopyToCV(sampleCV(), library, "skills").cv;
    const twice = addCopyToCV(once, library, "skills").cv;
    const copies = twice.sections[1].items.filter((item) => item.sourceItemId === "L1");
    expect(copies).toHaveLength(2);
    expect(copies[0].id).not.toBe(copies[1].id);
  });

  it("never changes the input CV", () => {
    const original = sampleCV();
    const snapshot = structuredClone(original);
    addCopyToCV(original, library, "skills", null, 0);
    expect(original).toEqual(snapshot);
  });
});

describe("moveCVItem (D-4)", () => {
  it("moves an item down within its group (gap index counts the moved item)", () => {
    const result = moveCVItem(sampleCV(), "s1", { sectionId: "experience", subsectionId: null, index: 3 })!;
    expect(texts(result.cv, "experience")).toEqual(["Stmt two", "Stmt three", "Stmt one"]);
    expect(result.position).toBe(3);
  });

  it("moves an item up within its group", () => {
    const result = moveCVItem(sampleCV(), "k3", { sectionId: "skills", subsectionId: null, index: 0 })!;
    expect(texts(result.cv, "skills")).toEqual(["SkillC", "SkillA", "SkillB"]);
    expect(result.position).toBe(1);
  });

  it("moves an item to another section", () => {
    const result = moveCVItem(sampleCV(), "s2", { sectionId: "other", subsectionId: null, index: 0 })!;
    expect(texts(result.cv, "experience")).toEqual(["Stmt one", "Stmt three"]);
    expect(texts(result.cv, "other")).toEqual(["Stmt two", "Volunteer mentor"]);
  });

  it("moves an item into an empty section", () => {
    const result = moveCVItem(sampleCV(), "s2", { sectionId: "education", subsectionId: null, index: 0 })!;
    expect(texts(result.cv, "education")).toEqual(["Stmt two"]);
    expect(result.position).toBe(1);
  });

  it("moves an item into and out of a subsection, updating its placement", () => {
    const into = moveCVItem(sampleCV(), "s1", { sectionId: "experience", subsectionId: "acme", index: 1 })!;
    expect(texts(into.cv, "experience", "acme")).toEqual(["Acme one", "Stmt one", "Python"]);
    const out = moveCVItem(into.cv, "a1", { sectionId: "experience", subsectionId: null, index: 0 })!;
    expect(texts(out.cv, "experience")).toEqual(["Acme one", "Stmt two", "Stmt three"]);
    expect(out.cv.sections[2].items.find((item) => item.id === "a1")!.subsectionId).toBeNull();
  });

  it("returns null for unknown items or sections", () => {
    expect(moveCVItem(sampleCV(), "missing", { sectionId: "skills", subsectionId: null, index: 0 })).toBeNull();
    expect(moveCVItem(sampleCV(), "k1", { sectionId: "missing", subsectionId: null, index: 0 })).toBeNull();
  });
});

describe("resolveInsertion (D-6)", () => {
  const statements = [statement("s1", "One"), statement("s2", "Two"), statement("s3", "Three")];
  const skills = [skill("k1", "A"), skill("k2", "B"), skill("k3", "C")];
  const rect = { left: 100, top: 100, width: 200, height: 20, right: 300, bottom: 120 };

  it("uses top/bottom halves for statements", () => {
    expect(resolveInsertion(statements, { overId: "s2", pointer: { x: 150, y: 105 }, overRect: rect }).index).toBe(1);
    expect(resolveInsertion(statements, { overId: "s2", pointer: { x: 150, y: 115 }, overRect: rect }).index).toBe(2);
  });

  it("uses left/right halves for skill chips", () => {
    expect(resolveInsertion(skills, { overId: "k2", pointer: { x: 150, y: 110 }, overRect: rect }).index).toBe(1);
    expect(resolveInsertion(skills, { overId: "k2", pointer: { x: 250, y: 110 }, overRect: rect }).index).toBe(2);
  });

  it("treats a pointer below or above the item as after or before it", () => {
    expect(resolveInsertion(skills, { overId: "k3", pointer: { x: 0, y: 200 }, overRect: rect }).index).toBe(3);
    expect(resolveInsertion(skills, { overId: "k1", pointer: { x: 999, y: 0 }, overRect: rect }).index).toBe(0);
  });

  it("drops at the end when not over an item (empty group or container)", () => {
    expect(resolveInsertion(statements, {}).index).toBe(3);
    expect(resolveInsertion([], {}).index).toBe(0);
  });

  it("flags drops that would not move the item", () => {
    expect(resolveInsertion(statements, { overId: "s2", activeId: "s2", pointer: { x: 150, y: 105 }, overRect: rect }).noop).toBe(true);
    expect(resolveInsertion(statements, { overId: "s3", activeId: "s2", pointer: { x: 150, y: 105 }, overRect: rect }).noop).toBe(true);
    expect(resolveInsertion(statements, { overId: "s3", activeId: "s2", pointer: { x: 150, y: 115 }, overRect: rect }).noop).toBe(false);
    expect(resolveInsertion(statements, { overId: "s1", pointer: { x: 150, y: 105 }, overRect: rect }).noop).toBe(false);
  });

  it("keyboard steps take the neighbour's place", () => {
    expect(resolveInsertion(statements, { overId: "s2", activeId: "s1", keyboard: true })).toEqual({ index: 2, noop: false });
    expect(resolveInsertion(statements, { overId: "s1", activeId: "s2", keyboard: true })).toEqual({ index: 0, noop: false });
    expect(resolveInsertion(statements, { overId: "s2", activeId: "s2", keyboard: true }).noop).toBe(true);
  });

  it("marker and drop agree: a resolved index produces the same order moveCVItem creates", () => {
    const cv = sampleCV();
    const group = cv.sections[2].items.filter((item) => !item.subsectionId);
    const { index } = resolveInsertion(group, { overId: "s3", activeId: "s1", pointer: { x: 150, y: 115 }, overRect: rect });
    const result = moveCVItem(cv, "s1", { sectionId: "experience", subsectionId: null, index })!;
    expect(texts(result.cv, "experience")).toEqual(["Stmt two", "Stmt three", "Stmt one"]);
  });
});

describe("markerPosition (D-6)", () => {
  const target = (index: number, extra: Partial<DropTarget> = {}): DropTarget =>
    ({ sectionId: "skills", subsectionId: null, index, noop: false, ...extra });

  it("draws the marker before the item at the gap index", () => {
    expect(markerPosition(target(1), "skills", null, 1, 3)).toBe("before");
    expect(markerPosition(target(1), "skills", null, 0, 3)).toBeNull();
  });

  it("draws an end marker after the last item", () => {
    expect(markerPosition(target(3), "skills", null, 2, 3)).toBe("after");
    expect(markerPosition(target(3), "skills", null, 1, 3)).toBeNull();
  });

  it("shows nothing for no-op drops, other groups or no target", () => {
    expect(markerPosition(target(1, { noop: true }), "skills", null, 1, 3)).toBeNull();
    expect(markerPosition(target(1), "experience", null, 1, 3)).toBeNull();
    expect(markerPosition(target(1, { subsectionId: "acme" }), "skills", null, 1, 3)).toBeNull();
    expect(markerPosition(null, "skills", null, 1, 3)).toBeNull();
  });
});

describe("ensurePlacement (statement placement tags)", () => {
  it("reuses an existing section, matching case-insensitively", () => {
    const result = ensurePlacement(sampleCV(), { sectionTitle: "  experience " });
    expect(result.sectionId).toBe("experience");
    expect(result.subsectionId).toBeNull();
    expect(result.cv.sections).toHaveLength(5);
  });

  it("creates a missing section and subsection", () => {
    const result = ensurePlacement(sampleCV(), { sectionTitle: "Projects", subsectionTitle: "Open source" });
    const created = result.cv.sections.at(-1)!;
    expect(created.title).toBe("Projects");
    expect(created.subsections).toEqual([{ id: result.subsectionId, title: "Open source", dates: "" }]);
  });

  it("reuses an existing subsection", () => {
    const result = ensurePlacement(sampleCV(), { sectionTitle: "Experience", subsectionTitle: "acme ltd" });
    expect(result.subsectionId).toBe("acme");
    expect(result.cv.sections[2].subsections).toHaveLength(1);
  });
});

describe("cvOutline (single source for preview, PDF and DOCX; E-3, D-10)", () => {
  it("lists content in section order, top-level items before subsections", () => {
    expect(cvOutline(sampleCV())).toEqual([
      { kind: "section", text: "Profile / Summary", isFirst: true, hasContent: true },
      { kind: "statement", text: "Product leader with ten years of experience." },
      { kind: "section", text: "Skills", isFirst: false, hasContent: true },
      { kind: "skills", skills: ["SkillA", "SkillB", "SkillC"] },
      { kind: "section", text: "Experience", isFirst: false, hasContent: true },
      { kind: "statement", text: "Stmt one" },
      { kind: "statement", text: "Stmt two" },
      { kind: "statement", text: "Stmt three" },
      { kind: "subsection", text: "Acme Ltd  |  2020-2023", hasContent: true },
      { kind: "statement", text: "Acme one" },
      { kind: "skills", skills: ["Python"] },
      { kind: "section", text: "Education", isFirst: false, hasContent: false },
      { kind: "section", text: "Other", isFirst: false, hasContent: true },
      { kind: "statement", text: "Volunteer mentor" },
    ]);
  });

  it("groups only consecutive skills, preserving interleaved order", () => {
    const cv = sampleCV();
    cv.sections[1].items = [skill("1", "A"), skill("2", " B  b "), statement("3", "S"), skill("4", "C")];
    expect(cvOutline(cv).slice(2, 6)).toEqual([
      { kind: "section", text: "Skills", isFirst: false, hasContent: true },
      { kind: "skills", skills: ["A", "B b"] },
      { kind: "statement", text: "S" },
      { kind: "skills", skills: ["C"] },
    ]);
  });

  it("skips sections with blank titles and omits empty subsection dates", () => {
    const cv = sampleCV();
    cv.sections[0].title = "   ";
    cv.sections[2].subsections[0].dates = "";
    const outline = cvOutline(cv);
    expect(outline[0]).toEqual({ kind: "section", text: "Skills", isFirst: true, hasContent: true });
    expect(outline).toContainEqual({ kind: "subsection", text: "Acme Ltd", hasContent: true });
  });
});

describe("helpers", () => {
  it("joins non-empty contact fields", () => {
    expect(contactLine({ name: "", title: "", email: "a@b.c", phone: "", location: "Leeds", links: "" })).toBe("a@b.c  |  Leeds");
  });

  it("labels placements", () => {
    expect(placementLabel(sampleCV(), "experience", "acme")).toBe("Experience / Acme Ltd");
    expect(placementLabel(sampleCV(), "skills", null)).toBe("Skills");
  });
});
