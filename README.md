# Fieldnote CV Builder

A client-side, single-page CV builder. Keep a reusable collection of skills and statements, place editable copies into a CV, and export a text-based PDF or editable Word document. Data is saved in browser local storage; no CV data is sent to a server.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build`, or serve the build with `npm run preview`.

## Testing

The test suite is the baseline for future changes: run it before and after every change.

```sh
npm run test:all     # type-check the tests, then unit tests, then end-to-end tests
npm test             # unit tests only (Vitest, ~1 s)
npm run test:e2e     # end-to-end tests (Playwright; builds and serves the app on port 4173)
npm run test:watch   # unit tests in watch mode
```

First-time setup for the end-to-end tests: `npx playwright install chromium`. After a failed end-to-end run, `npx playwright show-report` opens the report, with a trace of each failure.

- `tests/unit/` (Vitest, Node) covers the data model and drop logic (`cvModel.test.ts`), the paginated layout (`cvLayout.test.ts`), and the Word and PDF exports (`exports.test.ts`). Generated documents are inspected directly: Word heading styles, bulleted list, no manual breaks; PDF text order, page count and page size.
- `tests/e2e/` (Playwright, Chromium) drives the built app with real pointer, keyboard and touch input: collection (`collection.spec.ts`), drag-and-drop composition, keyboard alternatives, sections (`compose.spec.ts`), downloads and backups (`export.spec.ts`), visual rules such as skill pills and dark mode (`appearance.spec.ts`), and the phone layout (`mobile.spec.ts`).
- `tests/fixtures/cv.ts` holds the shared sample CVs and a stub text measurer, so layout tests don't need a canvas.
- Test names reference requirement IDs (for example `D-6`) from `Requirements Drag-and-Drop CV Builder.docx`.

## Architecture

- `src/cvModel.ts`: the typed data model, defaults, persistence, and pure operations: adding copies, moving items, resolving drop positions and insertion markers, statement placement tags, and `cvOutline`.
- `src/cvLayout.ts`: the paginated document layout used by the preview and the PDF. Text measurement is injectable.
- `src/exportPdf.ts` and `src/exportDocx.ts`: client-side PDF (jsPDF) and Word (docx) generation. Both are loaded only when an export is requested.
- `src/App.tsx`: the React UI, local autosave, drag-and-drop wiring (dnd-kit) and JSON backup export/import.
- `src/styles.css` defines the responsive workspace and paper-sized output preview. The app chrome uses the Coolors palette (`#dad7cd`, `#a3b18a`, `#588157`, `#3a5a40`, `#344e41`); the CV stays black-on-white.
- Collection items are copied into the CV. Editing or deleting a copy does not change its source item.
- Statements can carry a default section and subsection placement. Tagging creates the matching CV headings immediately; adding that statement from the collection places its copy there. Explicit drag-and-drop can choose a different destination.
- Each CV section can contain subsections with editable titles and dates. Removing a subsection keeps its CV items and moves them back to the parent section.
- Previously saved CVs are normalized on load so sections without subsections and CV items without subsection placement continue to work.
- The CV pane opens in the interactive editor so items can be dropped straight away. “Preview document” shows print-sized pages using the same wrapping and page breaks as the PDF export.
- The preview, PDF and DOCX are all built from one ordered outline of the CV (`cvOutline`), so wording and order match across outputs.
- The Word export is a fully editable document: the name uses Word's Title style, sections use Heading 1 (shown in capitals), subsections use Heading 2, statements are a real bulleted list, and skill lines use a “Skills” paragraph style. Word handles line wrapping and page breaks itself, so headings stay with their first item and items never split across pages, but page breaks can fall slightly differently from the preview.
- Skills render compactly: as inline chips in the editor, and in the preview and exports as consecutive skills joined on wrapping lines with a “·” separator. Statements render as bullet points.

## Assumptions

- The collection starts empty on first use, and the CV starts with the five default sections.
- The “+” control on a collection item asks which section to use and adds the copy at the end. Dragging places the copy exactly where the insertion marker shows: before or after the item under the pointer (left/right for skill chips, above/below for statements), or at the end of an empty section. The item stays in the collection.
- While dragging, CV items stay in place (the original is dimmed) and a single insertion marker shows the landing spot; the same calculation decides both the marker and the drop.
- A CV copy is edited by clicking its text. Up/down controls are the keyboard alternative for reordering; the drag handle supports pointer, touch long-press and keyboard dragging.
- The browser's confirmation dialog is used before deleting a collection item or a section that contains CV items.
- CV and collection data are persisted in local storage on this browser. Use Export backup / Import backup to move data between devices.
- A clean single-column layout is used for exports. Sections and text flow naturally across pages; page size can be changed between A4 and US Letter.
- A subsection tag is its heading text; date ranges are entered in the subsection on the CV preview.

## Requirements coverage

`Requirements Drag-and-Drop CV Builder.docx` (v2, baseline) records the status of every requirement and the known gaps. In summary:

- Implemented: C-1 to C-7, C-9; D-1 to D-10, D-13 to D-15; E-1 to E-9; A-1, A-5.
- Partial: A-2 (touch), A-3 (screen reader announcements).
- Not implemented: C-8 (tags), D-11 (multi-select), D-12 (undo/redo).
- Not verified: A-4 (contrast).

