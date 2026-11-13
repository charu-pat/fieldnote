import { useEffect, useMemo, useRef, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useDraggable,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  FileText,
  GripVertical,
  Leaf,
  MoreHorizontal,
  Moon,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  addCopyToCV,
  contactLine,
  ensurePlacement,
  fileName,
  groupSectionItems,
  loadSaved,
  markerPosition,
  moveCVItem,
  normalizeCV,
  placementLabel,
  resolveInsertion,
  sameTitle,
  STORAGE_KEY,
  type CVData,
  type CVItem,
  type DropTarget,
  type ItemType,
  type LibraryItem,
  type MarkerPosition,
  type PlacementTag,
  type SavedData,
  type Section,
  type Subsection,
} from "./cvModel";
import { layoutCV, type OutputPage } from "./cvLayout";

const CONTACT_FIELDS: [key: "email" | "phone" | "location" | "links", placeholder: string, label: string][] = [
  ["email", "Email address", "Email"],
  ["phone", "Phone number", "Phone"],
  ["location", "Location", "Location"],
  ["links", "Website or LinkedIn", "Links"],
];

const moveBy = <T,>(list: T[], from: number, direction: -1 | 1) =>
  arrayMove(list, from, Math.max(0, Math.min(list.length - 1, from + direction)));

// Items stay in place while dragging; the insertion marker shows where the drop will land.
const noShiftStrategy: SortingStrategy = () => null;

// Viewport pointer position from the latest collision pass. dnd-kit's event `delta` includes scroll
// offsets, so it cannot be used to locate the pointer once the CV or page has scrolled during a drag.
let latestPointer: { x: number; y: number } | null = null;

// Prefer the CV item under the pointer. Otherwise use the innermost section or subsection, snapped to
// its nearest item, so gaps between items still resolve to a precise insertion point.
const collisionDetection: CollisionDetection = (args) => {
  latestPointer = args.pointerCoordinates;
  if (!args.pointerCoordinates) return closestCorners(args);
  const pointer = args.pointerCoordinates;
  const dataFor = (id: string | number) => args.droppableContainers.find((container) => container.id === id)?.data.current;
  const hits = pointerWithin(args);
  const itemHits = hits.filter((collision) => dataFor(collision.id)?.kind === "cv");
  if (itemHits.length) return itemHits;
  const container = hits.find((collision) => dataFor(collision.id)?.kind === "subsection") ??
    hits.find((collision) => dataFor(collision.id)?.kind === "section");
  if (!container) return [];
  const containerData = dataFor(container.id);
  const subsectionId = containerData?.kind === "subsection" ? containerData.subsectionId : null;
  const groupRects = args.droppableContainers.flatMap((droppable) => {
    const data = droppable.data.current;
    const rect = args.droppableRects.get(droppable.id);
    if (!rect || data?.kind !== "cv" || data.sectionId !== containerData?.sectionId || (data.subsectionId ?? null) !== subsectionId) return [];
    return [{ id: droppable.id, rect }];
  });
  if (!groupRects.length) return [container];
  const readingOrder = [...groupRects].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  // Below or above the whole group means the end or the start, even when the nearest chip is mid-row.
  if (pointer.y > Math.max(...groupRects.map(({ rect }) => rect.bottom))) return [{ id: readingOrder[readingOrder.length - 1].id }];
  if (pointer.y < Math.min(...groupRects.map(({ rect }) => rect.top))) return [{ id: readingOrder[0].id }];
  const distanceTo = (rect: { left: number; right: number; top: number; bottom: number }) => Math.hypot(
    Math.max(rect.left - pointer.x, 0, pointer.x - rect.right),
    Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom),
  );
  const nearest = groupRects.reduce((best, entry) => distanceTo(entry.rect) < distanceTo(best.rect) ? entry : best);
  return [{ id: nearest.id }];
};

function dragPointer({ active }: Pick<DragMoveEvent, "active">) {
  if (latestPointer) return latestPointer;
  // Keyboard drags have no pointer; use the centre of the dragged overlay.
  const rect = active.rect.current.translated;
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
}

function OutputLines({ lines }: { lines: string[] }) {
  return <span className="cv-output-lines">{lines.map((line, index) => <span key={index}>{line}</span>)}</span>;
}

function CVOutputPageView({ page, pageSize, pageIndex, pageWidthPx }: {
  page: OutputPage;
  pageSize: CVData["pageSize"];
  pageIndex: number;
  pageWidthPx: number;
}) {
  const pageWidthMm = pageSize === "A4" ? 210 : 215.9;
  const cqw = (millimeters: number) => `${millimeters * 100 / pageWidthMm}cqw`;
  const headerClass = page.header.length ? "cv-header has-content" : "cv-header";
  return (
    <div className="cv-paper-frame" style={{ width: pageWidthPx }}>
      <article className={`cv-paper output-preview ${pageSize === "Letter" ? "letter" : ""}`} aria-label={`${pageSize} CV preview page ${pageIndex + 1}`}>
        {page.header.length > 0 && <header className={headerClass}>
          {page.header.filter((block) => block.kind !== "rule").map((block, index) => (
            <div
              key={`${block.kind}-${index}`}
              className={block.kind === "name" ? "cv-name" : block.kind === "title" ? "cv-job-title" : "contact-line"}
              style={{ marginBottom: cqw(block.afterMm) }}
            >
              <OutputLines lines={block.lines} />
            </div>
          ))}
        </header>}
        <div className="cv-sections output-page-content">
          {page.blocks.map((block, index) => {
            const before = cqw(block.beforeMm);
            const after = cqw(block.afterMm);
            if (block.kind === "section") return (
              <section key={`${block.kind}-${index}`} className="cv-section" style={{ marginTop: before }}>
                <div className="cv-section-heading output-section-heading">
                  <span className="section-title"><OutputLines lines={block.lines} /></span>
                </div>
              </section>
            );
            if (block.kind === "subsection") return (
              <div key={`${block.kind}-${index}`} className="cv-subsection output-subsection" style={{ marginTop: before, marginLeft: cqw(block.indentMm) }}>
                <div className="subsection-heading" style={{ marginBottom: after }}><OutputLines lines={block.lines} /></div>
              </div>
            );
            return (
              <div key={`${block.kind}-${index}`} className="draft-item output-item" style={{ paddingBottom: after, paddingLeft: cqw(block.indentMm) }}>
                <span className="draft-text"><OutputLines lines={block.lines} /></span>
              </div>
            );
          })}
        </div>
      </article>
    </div>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CollectionCard({ item, sections, onAdd, onAddTagged, onEdit, onDelete }: {
  item: LibraryItem;
  sections: Section[];
  onAddTagged: () => void;
  onAdd: (sectionId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [choosingSection, setChoosingSection] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `library-${item.id}`,
    data: { kind: "library", item },
  });
  return (
    <article ref={setNodeRef} className={`library-card ${item.type} ${isDragging ? "is-dragging" : ""}`}>
      <button className="drag-handle" aria-label={`Drag ${item.type}: ${item.text}`} {...listeners} {...attributes}>
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <div className="library-copy">
        <span className="item-kind">{item.type}</span>
        <p>{item.text}</p>
        {item.placement && <span className="placement-label">{item.placement.sectionTitle}{item.placement.subsectionTitle ? ` / ${item.placement.subsectionTitle}` : ""}</span>}
      </div>
      <div className="card-actions">
        <button className="icon-button" aria-label={item.placement ? `Add ${item.text} to its tagged CV placement` : `Choose a section for ${item.text}`} title="Add to CV" onClick={() => {
          if (item.placement) onAddTagged();
          else setChoosingSection((choosing) => !choosing);
        }}>
          <Plus size={16} />
        </button>
        <button className="icon-button subtle-action" aria-label={`Edit ${item.text}`} title="Edit item" onClick={onEdit}>
          <MoreHorizontal size={17} />
        </button>
        <button className="icon-button subtle-action delete-action" aria-label={`Delete ${item.text}`} title="Delete item" onClick={onDelete}>
          <Trash2 size={15} />
        </button>
      </div>
      {choosingSection && <div className="section-picker">
        <label htmlFor={`section-for-${item.id}`}>Add copy to</label>
        <select id={`section-for-${item.id}`} autoFocus value="" onChange={(event) => {
          if (event.target.value) onAdd(event.target.value);
          setChoosingSection(false);
        }} onBlur={() => setChoosingSection(false)}>
          <option value="" disabled>Choose a section…</option>
          {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
        </select>
      </div>}
    </article>
  );
}

function DraftItem({ item, sectionId, subsectionId, index, total, marker, onEdit, onRemove, onMove }: {
  item: CVItem;
  sectionId: string;
  subsectionId: string | null;
  index: number;
  total: number;
  marker: MarkerPosition;
  onEdit: (text: string) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  // No transform/transition styles: the no-shift strategy keeps items in place while dragging.
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: item.id, data: { kind: "cv", sectionId, subsectionId, item } });
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(item.text);
  useEffect(() => setDraftText(item.text), [item.text]);
  const save = () => {
    if (draftText.trim()) onEdit(draftText.trim());
    else setDraftText(item.text);
    setEditing(false);
  };
  return (
    <div ref={setNodeRef} role="listitem" data-cv-item-id={item.id} className={`draft-item ${item.type} ${isDragging ? "is-dragging" : ""} ${marker ? `marker-${marker}` : ""}`}>
      <button className="draft-grip" aria-label={`Reorder ${item.text}`} {...listeners} {...attributes}>
        <GripVertical size={15} />
      </button>
      {editing ? (
        <textarea
          autoFocus
          className="inline-edit"
          value={draftText}
          maxLength={item.type === "skill" ? 80 : 500}
          aria-label="Edit CV item"
          onChange={(event) => setDraftText(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setDraftText(item.text); setEditing(false); }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
          }}
        />
      ) : (
        <button className="draft-text" onClick={() => setEditing(true)} aria-label={`Edit CV copy: ${item.text}`}>
          {item.text}
        </button>
      )}
      <ReorderTools className="draft-tools" noun="item" index={index} total={total} onMove={onMove} removeLabel="Remove item from CV" removeIconSize={15} onRemove={onRemove} />
    </div>
  );
}

function ReorderTools({ className, noun, index, total, onMove, removeLabel, removeIconSize = 14, onRemove }: {
  className: string;
  noun: "item" | "section";
  index: number;
  total: number;
  onMove: (direction: -1 | 1) => void;
  removeLabel: string;
  removeIconSize?: number;
  onRemove: () => void;
}) {
  return (
    <div className={className}>
      <button className="icon-button" aria-label={`Move ${noun} up`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
      <button className="icon-button" aria-label={`Move ${noun} down`} disabled={index === total - 1} onClick={() => onMove(1)}><ArrowDown size={14} /></button>
      <button className="icon-button delete-action" aria-label={removeLabel} onClick={onRemove}><X size={removeIconSize} /></button>
    </div>
  );
}

/** A text input with a local draft, committed on blur or Enter. Returning `false` from `onCommit` reverts the draft. */
function CommitInput({ value, onCommit, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "onKeyDown"> & {
  value: string;
  onCommit: (draft: string) => boolean | void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { if (onCommit(draft) === false) setDraft(value); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />
  );
}

/** Registers a section, or one of its subsections, as a drop zone. collisionDetection reads this data. */
const useGroupDropRef = (sectionId: string, subsectionId: string | null = null) => useDroppable(subsectionId
  ? { id: `subsection-${subsectionId}`, data: { kind: "subsection", sectionId, subsectionId } }
  : { id: `section-${sectionId}`, data: { kind: "section", sectionId } }).setNodeRef;

function CVSubsection({ sectionId, subsection, hasItems, isDropTarget, onRename, onDatesChange, onRemove, children }: {
  sectionId: string;
  subsection: Subsection;
  hasItems: boolean;
  isDropTarget: boolean;
  onRename: (title: string) => boolean;
  onDatesChange: (dates: string) => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const dropRef = useGroupDropRef(sectionId, subsection.id);
  return (
    <div ref={dropRef} role="listitem" className={`cv-subsection ${isDropTarget ? "drop-target" : ""}`}>
      <div className="subsection-heading">
        <CommitInput aria-label={`Subsection name: ${subsection.title}`} value={subsection.title} onCommit={(draft) => !!draft.trim() && onRename(draft.trim())} />
        <CommitInput aria-label={`Dates for ${subsection.title}`} placeholder="Dates (e.g. 2020–2023)" value={subsection.dates} onCommit={(draft) => onDatesChange(draft.trim())} />
        <button className="icon-button delete-action" aria-label={`Remove ${subsection.title} subsection`} onClick={onRemove}><X size={14} /></button>
      </div>
      {children}
      {!hasItems && <p className="subsection-drop-prompt">Drop statements here</p>}
    </div>
  );
}

function CVSection({ section, index, total, isDropTarget, onRename, onRemove, onMoveSection, onAddSubsection, children, isEmpty }: {
  section: Section;
  index: number;
  total: number;
  isDropTarget: boolean;
  onRename: (title: string) => void;
  onRemove: () => void;
  onMoveSection: (direction: -1 | 1) => void;
  onAddSubsection: (title: string, dates: string) => void;
  children: React.ReactNode;
  isEmpty: boolean;
}) {
  const dropRef = useGroupDropRef(section.id);
  const [editing, setEditing] = useState(false);
  const [addingSubsection, setAddingSubsection] = useState(false);
  const [subsectionTitle, setSubsectionTitle] = useState("");
  const [subsectionDates, setSubsectionDates] = useState("");
  const submitSubsection = (event: React.FormEvent) => {
    event.preventDefault();
    if (!subsectionTitle.trim()) return;
    onAddSubsection(subsectionTitle.trim(), subsectionDates.trim());
    setSubsectionTitle("");
    setSubsectionDates("");
    setAddingSubsection(false);
  };
  return (
    <section ref={dropRef} className={`cv-section ${isDropTarget ? "drop-target" : ""}`}>
      <div className="cv-section-heading">
        {editing ? (
          <CommitInput autoFocus aria-label="Rename section" value={section.title} onCommit={(draft) => {
            if (draft.trim()) onRename(draft.trim());
            setEditing(false);
          }} />
        ) : (
          <button className="section-title" onClick={() => setEditing(true)} aria-label={`Rename ${section.title} section`}>{section.title}</button>
        )}
        <ReorderTools className="section-tools" noun="section" index={index} total={total} onMove={onMoveSection} removeLabel={`Remove ${section.title} section`} onRemove={onRemove} />
      </div>
      {children}
      {isEmpty && <p className="drop-prompt">Drag an item here, or use <span>+</span> in your collection</p>}
      {addingSubsection ? (
        <form className="subsection-form" onSubmit={submitSubsection}>
          <input autoFocus aria-label={`New subsection name in ${section.title}`} placeholder="Company, school, project…" value={subsectionTitle} onChange={(event) => setSubsectionTitle(event.target.value)} />
          <input aria-label="Subsection dates" placeholder="Dates (optional)" value={subsectionDates} onChange={(event) => setSubsectionDates(event.target.value)} />
          <button className="button add-button" type="submit" disabled={!subsectionTitle.trim()}><Plus size={14} /> Add subsection</button>
          <button className="text-button" type="button" onClick={() => setAddingSubsection(false)}>Cancel</button>
        </form>
      ) : (
        <button className="add-subsection" onClick={() => setAddingSubsection(true)}><Plus size={13} /> Add subsection</button>
      )}
    </section>
  );
}

export default function App() {
  const initial = useMemo(loadSaved, []);
  const [collection, setCollection] = useState(initial.collection);
  const [cv, setCV] = useState(initial.cv);
  const [filter, setFilter] = useState<"all" | ItemType>("all");
  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState<ItemType>("skill");
  const [newText, setNewText] = useState("");
  const [sectionTag, setSectionTag] = useState("");
  const [subsectionTag, setSubsectionTag] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<LibraryItem | CVItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("fieldnote-theme") === "dark"; }
    catch { return false; }
  });
  const [activeTab, setActiveTab] = useState<"collection" | "cv">("collection");
  const [outputPreview, setOutputPreview] = useState(false);
  const [toast, setToast] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const paperStage = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(700);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ collection, cv })); }
    catch (error) { console.error("Could not save the CV workspace.", error); setToast("Could not save changes in this browser."); }
  }, [collection, cv]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark-theme", darkMode);
    try { localStorage.setItem("fieldnote-theme", darkMode ? "dark" : "light"); }
    catch (error) { console.error("Could not save the color theme preference.", error); }
  }, [darkMode]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const stage = paperStage.current;
    if (!stage) return;
    const measure = () => {
      const style = window.getComputedStyle(stage);
      const available = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const width = Math.max(1, Math.min(700, available));
      setPreviewWidth((current) => current === width ? current : width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const query = search.toLowerCase();
  const visibleItems = collection.filter((item) =>
    (filter === "all" || item.type === filter) && item.text.toLowerCase().includes(query),
  );
  const typeCounts = useMemo(() => {
    const counts = { all: collection.length, skill: 0, statement: 0 };
    for (const item of collection) counts[item.type] += 1;
    return counts;
  }, [collection]);
  const totalDraftItems = cv.sections.reduce((sum, section) => sum + section.items.length, 0);
  const hasHeaderContent = Boolean(cv.header.name || cv.header.title || contactLine(cv.header));
  // Only lay out pages when the preview is visible; the editor doesn't need them.
  const outputPages = useMemo(() => outputPreview ? layoutCV(cv, previewWidth) : [], [outputPreview, cv, previewWidth]);

  const resetForm = () => {
    setEditingId(null);
    setNewText("");
    setSectionTag("");
    setSubsectionTag("");
  };

  const addItem = (event: React.FormEvent) => {
    event.preventDefault();
    const text = newText.trim();
    if (!text) return;
    const maxLength = itemType === "skill" ? 80 : 500;
    if (text.length > maxLength) return;
    const duplicate = collection.some((item) =>
      item.id !== editingId && item.type === itemType && item.text.toLowerCase() === text.toLowerCase(),
    );
    if (duplicate) {
      setToast("That item is already in your collection.");
      return;
    }
    const placement = itemType === "statement" && sectionTag.trim()
      ? { sectionTitle: sectionTag.trim(), ...(subsectionTag.trim() ? { subsectionTitle: subsectionTag.trim() } : {}) }
      : undefined;
    if (placement) setCV(ensurePlacement(cv, placement).cv);
    if (editingId) {
      setCollection((items) => items.map((item) => item.id === editingId
        ? { ...item, type: itemType, text, placement }
        : item));
      setToast("Collection item updated.");
    } else {
      setCollection((items) => [{ id: crypto.randomUUID(), type: itemType, text, placement }, ...items]);
      setToast(placement ? `Added to your collection and created ${placement.sectionTitle}${placement.subsectionTitle ? ` / ${placement.subsectionTitle}` : ""} on the CV.` : "Added to your collection.");
    }
    resetForm();
  };

  const editLibraryItem = (item: LibraryItem) => {
    setEditingId(item.id);
    setItemType(item.type);
    setNewText(item.text);
    setSectionTag(item.placement?.sectionTitle ?? "");
    setSubsectionTag(item.placement?.subsectionTitle ?? "");
    document.querySelector(".collection-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("new-item-text")?.focus();
  };

  const removeLibraryItem = (item: LibraryItem) => {
    if (!window.confirm(`Delete “${item.text}” from your collection? Copies already on your CV will stay.`)) return;
    setCollection((items) => items.filter((entry) => entry.id !== item.id));
    if (editingId === item.id) resetForm();
    setToast("Removed from collection. CV copies are unchanged.");
  };

  const addToSection = (library: LibraryItem, sectionId: string, subsectionId: string | null = null, index = Infinity) => {
    const result = addCopyToCV(cv, library, sectionId, subsectionId, index);
    setCV(result.cv);
    setToast(`${library.type === "skill" ? "Skill" : "Statement"} added to ${placementLabel(cv, sectionId, subsectionId)}, position ${result.position}.`);
    setActiveTab("cv");
  };

  const addTaggedItem = (library: LibraryItem) => {
    if (!library.placement) return;
    const placement = ensurePlacement(cv, library.placement);
    setCV(addCopyToCV(placement.cv, library, placement.sectionId, placement.subsectionId).cv);
    setToast(`Statement added to ${library.placement.sectionTitle}${library.placement.subsectionTitle ? ` / ${library.placement.subsectionTitle}` : ""}.`);
    setActiveTab("cv");
  };

  // Single source of truth for where a drop lands; used for both the insertion marker and the drop itself.
  const resolveDrop = (event: Pick<DragMoveEvent, "active" | "over" | "activatorEvent">): DropTarget | null => {
    const { active, over } = event;
    const overData = over?.data.current;
    const sectionId = overData?.sectionId as string | undefined;
    const section = sectionId ? cv.sections.find((entry) => entry.id === sectionId) : undefined;
    if (!over || !overData || !section) return null;
    const subsectionId = overData.kind === "section" ? null : ((overData.subsectionId as string | null | undefined) ?? null);
    const group = section.items.filter((item) => item.subsectionId === subsectionId);
    const overId = overData.kind === "cv" ? String(over.id) : null;
    const element = overId ? document.querySelector(`[data-cv-item-id="${window.CSS.escape(overId)}"]`) : null;
    const { index, noop } = resolveInsertion(group, {
      overId,
      activeId: active.data.current?.kind === "cv" ? String(active.id) : null,
      keyboard: event.activatorEvent instanceof KeyboardEvent,
      pointer: dragPointer(event),
      overRect: element?.getBoundingClientRect() ?? null,
    });
    return { sectionId: section.id, subsectionId, index, noop };
  };
  const clearDrag = () => {
    setActiveItem(null);
    setDropTarget(null);
  };
  const onDragStart = ({ active }: DragStartEvent) => {
    const data = active.data.current;
    setActiveItem(data?.item ?? null);
  };
  const onDragMove = (event: DragMoveEvent) => {
    const next = resolveDrop(event);
    setDropTarget((current) =>
      current?.sectionId === next?.sectionId && current?.subsectionId === next?.subsectionId &&
      current?.index === next?.index && current?.noop === next?.noop ? current : next);
  };
  const moveDraftTo = (itemId: string, target: DropTarget) => {
    const result = moveCVItem(cv, itemId, target);
    if (!result) return;
    setCV(result.cv);
    setToast(`Moved to ${placementLabel(cv, target.sectionId, target.subsectionId)}, position ${result.position}.`);
  };
  const onDragEnd = (event: DragEndEvent) => {
    const target = resolveDrop(event);
    clearDrag();
    if (!target) return;
    const data = event.active.data.current;
    if (data?.kind === "library") addToSection(data.item as LibraryItem, target.sectionId, target.subsectionId, target.index);
    else if (data?.kind === "cv" && !target.noop) moveDraftTo(String(event.active.id), target);
  };

  const findSection = (sectionId: string) => cv.sections.find((section) => section.id === sectionId);
  const updateSection = (sectionId: string, update: (section: Section) => Section) =>
    setCV((current) => ({ ...current, sections: current.sections.map((section) => section.id === sectionId ? update(section) : section) }));
  const updateAllItems = (update: (items: CVItem[]) => CVItem[]) =>
    setCV((current) => ({ ...current, sections: current.sections.map((section) => ({ ...section, items: update(section.items) })) }));
  const retagPlacements = (matches: (placement: PlacementTag) => boolean, changes: Partial<PlacementTag>) =>
    setCollection((current) => current.map((item) => item.placement && matches(item.placement)
      ? { ...item, placement: { ...item.placement, ...changes } }
      : item));
  const subsectionTaken = (section: Section, title: string, exceptId?: string) =>
    section.subsections.some((entry) => entry.id !== exceptId && sameTitle(entry.title, title));

  const removeDraftItem = (itemId: string) => updateAllItems((items) => items.filter((item) => item.id !== itemId));
  const updateDraftText = (itemId: string, text: string) => updateAllItems((items) => items.map((item) => item.id === itemId ? { ...item, text } : item));
  const moveDraft = (sectionId: string, itemId: string, subsectionId: string | null, direction: -1 | 1) => updateSection(sectionId, (section) => {
    const group = section.items.filter((item) => item.subsectionId === subsectionId);
    const reordered = moveBy(group, group.findIndex((item) => item.id === itemId), direction);
    return { ...section, items: [...section.items.filter((item) => item.subsectionId !== subsectionId), ...reordered] };
  });
  const updateHeader = (key: keyof CVData["header"], value: string) => setCV((current) => ({ ...current, header: { ...current.header, [key]: value } }));

  const moveSection = (id: string, direction: -1 | 1) =>
    setCV((current) => ({ ...current, sections: moveBy(current.sections, current.sections.findIndex((section) => section.id === id), direction) }));
  const renameSection = (id: string, title: string) => {
    const previous = findSection(id)?.title;
    if (!previous) return;
    updateSection(id, (section) => ({ ...section, title }));
    retagPlacements((placement) => sameTitle(placement.sectionTitle, previous), { sectionTitle: title });
  };
  const removeSection = (id: string) => {
    const section = findSection(id);
    if (section && (section.items.length || section.subsections.length) &&
      !window.confirm(`Remove “${section.title}” and its ${section.items.length} CV item(s) and ${section.subsections.length} subsection(s)?`)) return;
    setCV((current) => ({ ...current, sections: current.sections.filter((entry) => entry.id !== id) }));
  };

  const addSubsection = (sectionId: string, title: string, dates: string) => {
    const section = findSection(sectionId);
    if (section && subsectionTaken(section, title)) {
      setToast("That subsection already exists.");
      return;
    }
    const subsection = { id: crypto.randomUUID(), title, dates };
    updateSection(sectionId, (entry) => ({ ...entry, subsections: [...entry.subsections, subsection] }));
  };
  const updateSubsection = (sectionId: string, subsectionId: string, updates: Partial<Pick<Subsection, "title" | "dates">>): boolean => {
    const section = findSection(sectionId);
    const subsection = section?.subsections.find((entry) => entry.id === subsectionId);
    if (!section || !subsection) return false;
    if (updates.title && subsectionTaken(section, updates.title, subsectionId)) {
      setToast("That subsection name already exists.");
      return false;
    }
    updateSection(sectionId, (entry) => ({
      ...entry,
      subsections: entry.subsections.map((sub) => sub.id === subsectionId ? { ...sub, ...updates } : sub),
    }));
    const title = updates.title?.trim();
    if (title && title !== subsection.title) {
      retagPlacements(
        (placement) => sameTitle(placement.sectionTitle, section.title) && sameTitle(placement.subsectionTitle ?? "", subsection.title),
        { subsectionTitle: title },
      );
    }
    return true;
  };
  const removeSubsection = (sectionId: string, subsectionId: string) => {
    const section = findSection(sectionId);
    const subsection = section?.subsections.find((entry) => entry.id === subsectionId);
    if (!section || !subsection) return;
    const itemCount = section.items.filter((item) => item.subsectionId === subsectionId).length;
    if (itemCount && !window.confirm(`Remove “${subsection.title}”? Its ${itemCount} CV item(s) will stay in ${section.title}.`)) return;
    updateSection(sectionId, (entry) => ({
      ...entry,
      subsections: entry.subsections.filter((sub) => sub.id !== subsectionId),
      items: entry.items.map((item) => item.subsectionId === subsectionId ? { ...item, subsectionId: null } : item),
    }));
  };

  const exportDocx = async () => {
    try {
      const { docxBlob } = await import("./exportDocx");
      downloadBlob(await docxBlob(cv), fileName(cv.header.name, "docx"));
      setMenuOpen(false);
    } catch (error) {
      console.error("Could not export Word document.", error);
      setToast("Could not export the Word document. Please try again.");
    }
  };

  const exportPDF = async () => {
    try {
      const { buildPdf } = await import("./exportPdf");
      downloadBlob(buildPdf(cv).output("blob"), fileName(cv.header.name, "pdf"));
      setMenuOpen(false);
    } catch (error) {
      console.error("Could not export PDF.", error);
      setToast("Could not export the PDF. Please try again.");
    }
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ collection, cv }, null, 2)], { type: "application/json" });
    downloadBlob(blob, fileName(cv.header.name, "json"));
    setMenuOpen(false);
  };
  const importJSON = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as SavedData;
      if (!Array.isArray(parsed.collection) || !parsed.cv?.header || !Array.isArray(parsed.cv.sections)) throw new Error("Invalid backup format.");
      setCollection(parsed.collection);
      setCV(normalizeCV(parsed.cv));
      setToast("Your backup has been imported.");
    } catch (error) {
      console.error("Could not import backup.", error);
      setToast("That file could not be imported. Choose a Fieldnote JSON backup.");
    }
    event.target.value = "";
    setMenuOpen(false);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragMove={onDragMove} onDragOver={onDragMove} onDragEnd={onDragEnd} onDragCancel={clearDrag}>
      <div className="app-shell">
        <header className="topbar">
          <a className="brand" href="#" aria-label="Fieldnote home"><span className="brand-mark"><Leaf size={17} /></span><span>fieldnote<span className="brand-period">.</span></span></a>
          <div className="topbar-actions">
            <button className="theme-toggle" aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} title={darkMode ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setDarkMode((enabled) => !enabled)}>
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <label className="page-size-label" htmlFor="page-size">Paper</label>
            <select id="page-size" value={cv.pageSize} onChange={(event) => setCV((current) => ({ ...current, pageSize: event.target.value as CVData["pageSize"] }))}>
              <option value="A4">A4</option><option value="Letter">US Letter</option>
            </select>
            <div className="export-wrap">
              <button className="button primary export-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}>
                <Download size={16} /> Export <ChevronDown size={14} />
              </button>
              {menuOpen && <div className="export-menu">
                <button onClick={() => void exportPDF()}><FileText size={16} /><span><b>Download PDF</b><small>Selectable, print-ready text</small></span></button>
                <button onClick={() => void exportDocx()}><FileText size={16} /><span><b>Download Word</b><small>Editable .docx document</small></span></button>
                <hr />
                <button onClick={exportJSON}><Download size={15} /><span><b>Export backup</b><small>Save collection and CV as JSON</small></span></button>
                <button onClick={() => fileInput.current?.click()}><Undo2 size={15} /><span><b>Import backup</b><small>Restore a Fieldnote JSON file</small></span></button>
                <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importJSON(event)} />
              </div>}
            </div>
          </div>
        </header>

        <main className="workspace">
          <nav className="mobile-tabs" aria-label="Workspace views">
            <button className={activeTab === "collection" ? "active" : ""} onClick={() => setActiveTab("collection")}>Collection <span>{collection.length}</span></button>
            <button className={activeTab === "cv" ? "active" : ""} onClick={() => setActiveTab("cv")}>Your CV <span>{totalDraftItems}</span></button>
          </nav>
          <aside className={`collection-pane ${activeTab === "collection" ? "mobile-active" : ""}`}>
            <div className="pane-heading">
              <div><p className="eyebrow">YOUR CONTENT BANK</p><h1>Collection <span>{collection.length}</span></h1></div>
              <button className="text-button" onClick={() => { resetForm(); setItemType("skill"); document.getElementById("new-item-text")?.focus(); }}><Plus size={16} /> Add new</button>
            </div>
            <form className="collection-form" onSubmit={addItem}>
              <div className="form-top">
                <label htmlFor="new-item-text">{editingId ? "Edit item" : "Add to your collection"}</label>
                <div className="type-toggle" role="group" aria-label="Item type">
                  <button type="button" className={itemType === "skill" ? "selected" : ""} onClick={() => { setItemType("skill"); setSectionTag(""); setSubsectionTag(""); }}>Skill</button>
                  <button type="button" className={itemType === "statement" ? "selected" : ""} onClick={() => setItemType("statement")}>Statement</button>
                </div>
              </div>
              <textarea
                id="new-item-text"
                placeholder={itemType === "skill" ? "e.g. Stakeholder management" : "e.g. Led a team of 6 to deliver a platform migration…"}
                value={newText}
                maxLength={itemType === "skill" ? 80 : 500}
                rows={itemType === "skill" ? 1 : 3}
                onChange={(event) => setNewText(event.target.value)}
                aria-describedby="character-count"
              />
              {itemType === "statement" && <div className="placement-fields">
                <p>Default CV placement <span>Optional</span></p>
                <div>
                  <label>
                    <span>Section</span>
                    <input list="cv-section-tags" placeholder="e.g. Experience" value={sectionTag} onChange={(event) => setSectionTag(event.target.value)} />
                  </label>
                  <label>
                    <span>Subsection</span>
                    <input list="cv-subsection-tags" placeholder="e.g. Acme · 2022–2025" value={subsectionTag} onChange={(event) => setSubsectionTag(event.target.value)} />
                  </label>
                </div>
                <datalist id="cv-section-tags">{cv.sections.map((section) => <option key={section.id} value={section.title} />)}</datalist>
                <datalist id="cv-subsection-tags">{cv.sections.flatMap((section) => section.subsections.map((subsection) => <option key={subsection.id} value={subsection.title} />))}</datalist>
                <small>Tagged statements create these CV headings immediately and default to that placement.</small>
              </div>}
              <div className="form-bottom"><span id="character-count">{newText.length} / {itemType === "skill" ? 80 : 500}</span><div>
                {editingId && <button className="text-button cancel-edit" type="button" onClick={resetForm}>Cancel</button>}
                <button className="button add-button" type="submit" disabled={!newText.trim()}>{editingId ? <Check size={15} /> : <Plus size={15} />}{editingId ? "Save changes" : "Add item"}</button>
              </div></div>
            </form>

            <div className="collection-controls">
              <div className="filter-tabs" role="tablist" aria-label="Filter by item type">
                {(["all", "skill", "statement"] as const).map((value) => <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>
                  {value === "all" ? "All" : value === "skill" ? "Skills" : "Statements"}<span>{typeCounts[value]}</span>
                </button>)}
              </div>
              <label className="search-field"><Search size={16} /><input type="search" placeholder="Search your collection" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search collection" />{search && <button aria-label="Clear search" onClick={() => setSearch("")}><X size={14} /></button>}</label>
            </div>
            <div className="collection-list" aria-label="Collection items">
              {visibleItems.length ? visibleItems.map((item) => <CollectionCard key={item.id} item={item} sections={cv.sections} onAdd={(sectionId) => addToSection(item, sectionId)} onAddTagged={() => addTaggedItem(item)} onEdit={() => editLibraryItem(item)} onDelete={() => removeLibraryItem(item)} />) :
                <div className="empty-collection"><div className="empty-icon"><Sparkles size={19} /></div><b>{search ? "No matches found" : "Your collection is clear"}</b><p>{search ? "Try another search term." : "Add a skill or statement above to get started."}</p></div>}
            </div>
            <div className="privacy-note"><ShieldCheck size={16} /><span>Your work stays on this device. Nothing is sent to a server.</span></div>
          </aside>

          <section className={`preview-pane ${activeTab === "cv" ? "mobile-active" : ""}`}>
            <div className="preview-toolbar">
              <div><p className="eyebrow">{outputPreview ? "DOCUMENT PREVIEW" : "LIVE EDITOR"}</p><h2>Your CV <span>{totalDraftItems} {totalDraftItems === 1 ? "item" : "items"}</span></h2></div>
              <div className="preview-toolbar-actions">
                {!outputPreview && <div className="preview-hint"><span className="hint-dot" />Changes save automatically</div>}
                <button className="preview-mode-toggle" onClick={() => setOutputPreview((current) => !current)}>
                  {outputPreview ? "Edit CV" : "Preview document"}
                </button>
              </div>
            </div>
            <div className="paper-stage" ref={paperStage}>
              {outputPreview ? (
                <div className="cv-pages" aria-label={`${cv.pageSize} document pages`}>
                  {outputPages.map((page, pageIndex) => <CVOutputPageView key={pageIndex} page={page} pageSize={cv.pageSize} pageIndex={pageIndex} pageWidthPx={previewWidth} />)}
                </div>
              ) : (
              <div className="cv-paper-frame">
                <article className={`cv-paper ${cv.pageSize === "Letter" ? "letter" : ""}`} aria-label={`${cv.pageSize} CV editor`}>
                <header className={`cv-header ${hasHeaderContent ? "has-content" : ""}`}>
                  <input className="cv-name" placeholder="Your name" aria-label="Name" value={cv.header.name} onChange={(event) => updateHeader("name", event.target.value)} />
                  <input className="cv-job-title" placeholder="Professional title" aria-label="Job title" value={cv.header.title} onChange={(event) => updateHeader("title", event.target.value)} />
                  <div className="contact-fields">
                    {CONTACT_FIELDS.map(([key, placeholder, label]) => (
                      <input key={key} placeholder={placeholder} aria-label={label} value={cv.header[key]} onChange={(event) => updateHeader(key, event.target.value)} />
                    ))}
                  </div>
                </header>
                <div className="cv-sections">
                  {cv.sections.map((section, sectionIndex) => {
                    const { top, bySubsection } = groupSectionItems(section);
                    const renderItems = (items: CVItem[], subsectionId: string | null) => items.map((item, itemIndex) => <DraftItem
                      key={item.id}
                      item={item}
                      sectionId={section.id}
                      subsectionId={subsectionId}
                      index={itemIndex}
                      total={items.length}
                      marker={markerPosition(dropTarget, section.id, subsectionId, itemIndex, items.length)}
                      onEdit={(text) => updateDraftText(item.id, text)}
                      onRemove={() => removeDraftItem(item.id)}
                      onMove={(direction) => moveDraft(section.id, item.id, subsectionId, direction)}
                    />);
                    return (
                      <CVSection
                        key={section.id}
                        section={section}
                        index={sectionIndex}
                        total={cv.sections.length}
                        isDropTarget={dropTarget?.sectionId === section.id && dropTarget.subsectionId === null}
                        onRename={(title) => renameSection(section.id, title)}
                        onRemove={() => removeSection(section.id)}
                        onMoveSection={(direction) => moveSection(section.id, direction)}
                        onAddSubsection={(title, dates) => addSubsection(section.id, title, dates)}
                        isEmpty={section.items.length === 0 && section.subsections.length === 0}
                      >
                        <SortableContext
                          items={[...top, ...section.subsections.flatMap((subsection) => bySubsection.get(subsection.id)!)].map((item) => item.id)}
                          strategy={noShiftStrategy}
                        >
                          <div className="draft-items" role="list" aria-label={`${section.title} items`}>
                            {renderItems(top, null)}
                            {section.subsections.map((subsection) => {
                              const subsectionItems = bySubsection.get(subsection.id)!;
                              return <CVSubsection
                                key={subsection.id}
                                sectionId={section.id}
                                subsection={subsection}
                                hasItems={subsectionItems.length > 0}
                                isDropTarget={dropTarget?.subsectionId === subsection.id}
                                onRename={(title) => updateSubsection(section.id, subsection.id, { title })}
                                onDatesChange={(dates) => updateSubsection(section.id, subsection.id, { dates })}
                                onRemove={() => removeSubsection(section.id, subsection.id)}
                              >
                                <div className="draft-items" role="list" aria-label={`${subsection.title} items`}>
                                  {renderItems(subsectionItems, subsection.id)}
                                </div>
                              </CVSubsection>;
                            })}
                          </div>
                        </SortableContext>
                      </CVSection>
                    );
                  })}
                </div>
                <button className="add-section" onClick={() => setCV((current) => ({ ...current, sections: [...current.sections, { id: crypto.randomUUID(), title: "New section", items: [], subsections: [] }] }))}><Plus size={14} /> Add section</button>
                </article>
              </div>
              )}
            </div>
            <div className="preview-footer"><span>{outputPreview ? "Preview reflects your selected page size and export styling." : <><span className="keyboard-icon">↵</span> Click any field to edit · Drag to rearrange</>}</span></div>
          </section>
        </main>
        <footer className="app-footer"><span><Leaf size={13} />Drag, drop, hired.</span><span>Your next role starts here.</span></footer>
        <div className="sr-only" aria-live="polite">{toast}</div>
        {toast && <div className="toast" role="status"><Check size={16} />{toast}<button aria-label="Dismiss message" onClick={() => setToast("")}><X size={14} /></button></div>}
      </div>
      <DragOverlay>{activeItem && <div className={`drag-overlay ${activeItem.type}`}>{activeItem.text}</div>}</DragOverlay>
    </DndContext>
  );
}
