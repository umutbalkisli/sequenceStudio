# Sequence Studio

> **Note:** This project, including its code and documentation, was generated with AI (Claude by Anthropic).

Sequence Studio is a browser-based editor for building UML sequence diagrams on top of [Mermaid](https://mermaid.js.org/). Software architects and engineers can lay out complex interaction flows visually, without writing Mermaid syntax by hand. The result is still standard Mermaid code that can be pasted into documentation, wikis, or pull requests.

It runs entirely in the browser. There is no backend, no database, and no third-party service. Mermaid is bundled with the app, so it makes no external network requests.

## Why Sequence Studio?

Mermaid is a good format for keeping diagrams next to code, but writing larger sequence diagrams by hand is slow and error-prone. You have to keep track of participant IDs, nested `alt`/`loop` blocks, and activation markers. Sequence Studio adds a visual layer on top of the text format:

- **Draw instead of type.** Add participants, connect them to create messages, and drag steps into loops and conditional blocks.
- **Keep the text.** The visual editor and the Mermaid code stay in sync in both directions. You can switch between them at any time.
- **Own your data.** Diagrams are stored in your browser (IndexedDB). Nothing leaves your machine unless you export or share it. Use **Back up** in the *My diagrams* menu to download the whole workspace — diagrams, folders, the catalog, roles and settings — as one file, and **Restore** to bring it back (merge or replace).

## Features

- **Visual builder**
  - Participant types: participant, actor, boundary, control, entity, database, collections, queue.
  - **Roles:** how a participant looks — shape, color and optional name prefix/suffix (for example *Service* adds " Service"). Click a role in the palette to add a new participant of that kind.
  - **Catalog:** the hierarchy of your real systems, like the C4 model (for example *Payments system › Ledger › Ledger DB*). Every item has a C4 type (person, system, container, component, or a *group* that only organizes the catalog and is never drawn) and an optional role; without a role, the look comes from the type. Misplaced items (say, a component directly in a system) are flagged, not blocked. Search and add items with the **Catalog** button in the palette, or save any participant with **Save to catalog**. Renaming an item or changing its role updates every diagram that uses it, and each item shows where it is used. A parent can be a participant too: draw a system as one box in one diagram and its parts in another. Participants named like a catalog item but not linked to it are flagged by the diagram check (one click to link), and **Link matches** links them across all diagrams at once.
  - Create a message by dragging one participant's connector onto another, or by picking participants from a searchable list.
  - Drag and drop to reorder steps and to move them into or out of blocks.
  - Custom colors for participants and blocks, and arrow tones (success, error, warning, info).
  - Multi-line labels (<kbd>Alt</kbd>+<kbd>Enter</kbd>), written to Mermaid as `<br/>`.
- **Control flow:** `loop`, `alt`/`else`, `opt`, `par`/`and`, `critical`/`option`, `break`, highlighted regions, notes, participant groups (`box`) and automatic numbering.
- **Automatic activation bars:** Each synchronous call is paired with its reply, and the period during which a participant is active is drawn for you. Early returns inside conditional blocks do not end the activation.
- **Links between diagrams:** A note can point to another diagram. Click it in the preview to open that diagram, and use the back button to return. Broken links are marked, and renaming a diagram updates the links to it. A small badge next to the diagram name lists the diagrams that link to it (backlinks). When exporting, linked diagrams can be drawn inline (recursively, with cycle detection).
- **Role legend:** The preview can show which roles and arrow tones are used. Exported code carries the role and catalog definitions it uses (with parent items), so another workspace can import what it does not have yet.
- **Architecture view (C4):** A second screen draws C1 (systems), C2 (containers) and C3 (components) from the catalog. Relationships are derived from the calls in your sequence diagrams, so the view stays in sync without extra work. Click an element to zoom in or to open the flows that use it, or click a relationship to see which flows (and which messages) it comes from; export as SVG, PNG or Mermaid.
- **Diagram check:** A badge in the preview header lists likely mistakes: broken links, unanswered calls, unused or duplicate participants, empty blocks, activations Mermaid can't draw. The affected steps are marked in the builder, and clicking a finding jumps to the step (or to the code line).
- **Code editor:** Syntax highlighting, line numbers, inline error reporting and automatic indentation.
- **Live preview**
  - Participants are drawn in the same colors as in the editor.
  - Zoom, pan and full-screen mode; the editor panel can be hidden.
  - Clicking a message in the preview jumps to that step in the editor.
- **Export**
  - PNG (up to 4×), SVG, Mermaid source (`.mmd`), plain text and **draw.io** (editable shapes, with labels attached to their shapes and arrows).
  - Theme, white or transparent background.
  - Export a whole folder, including subfolders, as one ZIP in any of these formats.
  - Images and code can also be copied to the clipboard.
- **Presentation mode:** Play a flow full screen, message by message, for meetings (<kbd>P</kbd> or the ▶ button in the preview). Upcoming steps are dimmed or hidden, the current message is highlighted and read out in a caption; use the arrow keys, Space or a click to advance, or autoplay at a chosen pace. It starts from the selected message if there is one.
- **Sharing:** A share link stores the compressed diagram in the URL itself, so no server is involved.
- **Workspace**
  - Multiple diagrams with autosave, organized in folders and subfolders (drag and drop).
  - Search across all diagrams, participants and messages (<kbd>⌘/Ctrl</kbd>+<kbd>K</kbd>).
  - Per-diagram version history: automatic and named versions, with a preview and line diff, and one-click restore.
  - Backup and restore of the whole workspace.
  - Templates for common flows (OAuth2, e-commerce checkout, event-driven messaging).
  - Import from `.mmd`, `.txt` or Markdown files.
  - Undo/redo, light and dark themes, and an English or Turkish interface.

## Getting Started

There is no build step. You can:

- open `index.html` directly in a modern browser, or
- serve the folder with any static file server, for example `python3 -m http.server`, or
- publish it as-is on GitHub Pages (or any static host).

Press the **?** button in the app for a quick guide and a list of keyboard shortcuts.

## Built With

- [Mermaid](https://mermaid.js.org/) v11, bundled under `vendor/mermaid/` and distributed under the MIT License.
- Plain HTML, CSS and JavaScript, with no frameworks and no runtime dependencies.

## Development

The app itself needs no tooling. Node.js is used only for the lint and test suite:

```sh
npm ci && npx playwright install chromium
npm test   # lint + unit tests + end-to-end tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code is organized.
