# Sequence Studio

> **Note:** This project, including its code and documentation, was generated with AI (Claude by Anthropic).

Sequence Studio is a browser-based editor for building UML sequence diagrams on top of [Mermaid](https://mermaid.js.org/). Software architects and engineers can lay out complex interaction flows visually, without writing Mermaid syntax by hand. The result is still standard Mermaid code that can be pasted into documentation, wikis, or pull requests.

It runs entirely in the browser. There is no backend, no database, and no third-party service. Mermaid is bundled with the app, so it makes no external network requests.

## Why Sequence Studio?

Mermaid is a good format for keeping diagrams next to code, but writing larger sequence diagrams by hand is slow and error-prone. You have to keep track of participant IDs, nested `alt`/`loop` blocks, and activation markers. Sequence Studio adds a visual layer on top of the text format:

- **Draw instead of type.** Add participants, connect them to create messages, and drag steps into loops and conditional blocks.
- **Keep the text.** The visual editor and the Mermaid code stay in sync in both directions. You can switch between them at any time.
- **Own your data.** Diagrams are stored in your browser's local storage. Nothing leaves your machine unless you export or share it.

## Features

- **Visual builder**
  - Participant types: participant, actor, boundary, control, entity, database, collections, queue.
  - Create a message by dragging one participant's connector onto another.
  - Drag and drop to reorder steps and to move them into or out of blocks.
- **Control flow:** `loop`, `alt`/`else`, `opt`, `par`/`and`, `critical`/`option`, `break`, highlighted regions, notes, participant groups (`box`) and automatic numbering.
- **Automatic activation bars:** Each synchronous call is paired with its reply, and the period during which a participant is active is drawn for you. Early returns inside conditional blocks do not end the activation.
- **Code editor:** Syntax highlighting, line numbers, inline error reporting and automatic indentation.
- **Live preview**
  - Participants are drawn in the same colors as in the editor.
  - Zoom, pan and full-screen mode; the editor panel can be hidden.
  - Clicking a message in the preview jumps to that step in the editor.
- **Export:** PNG (up to 4×, themed, white or transparent background), SVG, Mermaid source (`.mmd`) and plain text. Images and code can also be copied to the clipboard.
- **Sharing:** A share link stores the compressed diagram in the URL itself, so no server is involved.
- **Workspace**
  - Multiple diagrams with autosave.
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
