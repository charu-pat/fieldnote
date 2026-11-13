import type { CVData, CVItem, LibraryItem, SavedData, Section } from "../../src/cvModel";

export const skill = (id: string, text: string, subsectionId: string | null = null): CVItem =>
  ({ id, sourceItemId: null, type: "skill", text, subsectionId });
export const statement = (id: string, text: string, subsectionId: string | null = null): CVItem =>
  ({ id, sourceItemId: null, type: "statement", text, subsectionId });

export const LONG_STATEMENT =
  "Led a cross-functional team of eight engineers and designers to deliver a customer-facing platform migration two weeks ahead of schedule, reducing hosting costs by 30% and improving reliability.";

const section = (id: string, title: string, items: CVItem[] = [], subsections: Section["subsections"] = []): Section =>
  ({ id, title, items, subsections });

/** A small CV with every content type: header, skills, statements, a dated subsection and an empty section. */
export function sampleCV(overrides: Partial<CVData> = {}): CVData {
  return {
    header: { name: "Jane Doe", title: "Product Lead", email: "jane@example.com", phone: "0123 456", location: "London", links: "linkedin.com/in/jane" },
    pageSize: "A4",
    sections: [
      section("summary", "Profile / Summary", [statement("s0", "Product leader with ten years of experience.")]),
      section("skills", "Skills", [skill("k1", "SkillA"), skill("k2", "SkillB"), skill("k3", "SkillC")]),
      section("experience", "Experience", [
        statement("s1", "Stmt one"),
        statement("s2", "Stmt two"),
        statement("s3", "Stmt three"),
        statement("a1", "Acme one", "acme"),
        skill("a2", "Python", "acme"),
      ], [{ id: "acme", title: "Acme Ltd", dates: "2020-2023" }]),
      section("education", "Education"),
      section("other", "Other", [statement("o1", "Volunteer mentor")]),
    ],
    ...overrides,
  };
}

/** A CV long enough to need at least two pages. */
export function longCV(statementCount = 22): CVData {
  const cv = sampleCV();
  const experience = cv.sections.find((entry) => entry.id === "experience")!;
  experience.items = [
    ...Array.from({ length: statementCount }, (_, index) => statement(`long-${index + 1}`, `${index + 1}. ${LONG_STATEMENT}`)),
    ...experience.items.filter((item) => item.subsectionId),
  ];
  return cv;
}

export const sampleCollection = (): LibraryItem[] => [
  { id: "L1", type: "skill", text: "NewSkill" },
  { id: "L2", type: "statement", text: "NewStatement" },
];

/** A fuller collection (5 skills, 4 statements) for filtering, searching and editing tests. */
export const demoCollection = (): LibraryItem[] => [
  { id: "d1", type: "skill", text: "Stakeholder management" },
  { id: "d2", type: "skill", text: "Strategic planning" },
  { id: "d3", type: "skill", text: "Cross-functional leadership" },
  { id: "d4", type: "skill", text: "Product roadmapping" },
  { id: "d5", type: "skill", text: "Data-informed decision making" },
  { id: "d6", type: "statement", text: "Led a team of 6 to deliver a platform migration two weeks ahead of schedule." },
  { id: "d7", type: "statement", text: "Built trusted partnerships across design, engineering and commercial teams." },
  { id: "d8", type: "statement", text: "Introduced a quarterly planning rhythm that brought clarity to competing priorities." },
  { id: "d9", type: "statement", text: "Coached emerging leaders and created space for stronger, more confident teams." },
];

export const savedData = (cv: CVData = sampleCV(), collection: LibraryItem[] = sampleCollection()): SavedData => ({ collection, cv });

/**
 * Deterministic text measurer for layout tests (no canvas in Node). Each character is half the font size wide,
 * which is close to Arial's average advance width.
 */
export const stubMeasurer = () => {
  let fontPx = 10;
  return {
    get font() { return `${fontPx}px Arial`; },
    set font(value: string) { fontPx = Number(/([\d.]+)px/.exec(value)?.[1] ?? 10); },
    measureText: (text: string) => ({ width: [...text].length * fontPx * 0.5 }),
  };
};
