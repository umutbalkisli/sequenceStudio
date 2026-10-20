# Architecture

Sequence Studio is a static web app: plain HTML, CSS and JavaScript with no build step. It must keep
working when `index.html` is opened straight from disk (`file://`) and when hosted on GitHub Pages.
That rules out ES modules and bundlers. Every file is a classic `<script>`, and `index.html` loads them
in dependency order.

## Layout

```
index.html                 markup + script order
assets/css/                styles
assets/js/
  lib/                     pure logic with no DOM state; usable from Node (unit tests)
    model.js               Mermaid ⇄ model parser/serializer, auto activation, refs expansion  → window.SeqModel
    lint.js                diagram check rules                                                 → window.SeqLint
    c4.js                  C4 views from the catalog + relationships derived from diagrams      → window.SeqC4
    drawio.js              rendered SVG → draw.io XML                                          → window.SeqDrawio
    zip.js                 minimal ZIP writer                                                   → Seq.zip
  core/                    shared infrastructure
    i18n.js                Turkish/English strings                                              → window.SeqI18n
    icons.js               inline SVG icons                                                     → window.SeqIcons
    storage.js             IndexedDB (localStorage fallback), backups, versions                → window.SeqStorage
    core.js                DOM helpers, app state S, settings, modal/toast, event bus           → Seq.core
  data/templates.js        starter diagrams
  features/                one file per feature                                                 → Seq.<feature>
  main.js                  initializes the features in order, then boots
tests/
  unit/                    node:test tests for lib/
  e2e/                     Playwright tests against index.html (file://)
```

## Feature modules

Each feature file has the same shape:

```js
(function (Seq) {
  'use strict';
  const { S, T, h, events } = Seq.core;   // only core at load time

  function somethingPublic() { … }

  /** Wire DOM listeners and subscriptions. Called once by main.js after every file has loaded. */
  function init() { … }

  Seq.example = { init, somethingPublic };
})(window.Seq = window.Seq || {});
```

Rules:

- **Load time does nothing but define.** A module may read `Seq.core` while it loads. It reaches other
  features (`Seq.flow`, `Seq.preview`, …) only inside functions, so load order between features does
  not matter. Side effects (listeners, registrations) belong in `init()`, and `main.js` calls those in
  `INIT_ORDER`.
- **Talk through the public object.** Whatever is on `Seq.<name>` is the module's API. Everything else
  is private to the file.
- **Shared UI pieces** live in `core.js`: `h` (element builder), `ico`, `toast`, `openModal`, and
  `dropdown(anchor, render, opts)` for small popup lists (used by the lint and backlinks badges).
- **One reason to change.** If a file starts covering two concerns, split it. Shared helpers go to
  `core.js`. Pure logic that doesn't need the DOM goes to `lib/`, where it can be unit tested.

## Extension points

Common changes should only need new code, not edits to existing branches.

### Events (`Seq.core.events`)

The document lifecycle is published as events, so `docs.js` doesn't need to know who cares:

| Event            | Payload            | Emitted when                                  | Listeners |
|------------------|--------------------|-----------------------------------------------|-----------|
| `doc:opened`     | `{ doc }`          | a diagram became the active one               | backlinks, defs-notice, drawer, refs, versions |
| `doc:leaving`    | `{ doc }`          | before switching away / closing the page      | versions |
| `doc:saved`      | `{ doc }`          | the active diagram was saved                  | versions |
| `doc:deleted`    | `{ id }`           | a diagram was deleted                         | backlinks, drawer, lint, refs, versions |
| `doc:renamed`    | `{ id, from, to }` | the active diagram's name changed             | refs |
| `docs:persisted` | none               | the workspace was written to storage          | backlinks, backup |
| `code:changed`   | `{ src }`          | the code/model changed (any source)           | lint |
| `builder:rendered` | none             | the builder's step list was redrawn           | lint |
| `catalog:changed` | none              | the catalog was edited                        | arch |
| `theme:changed`  | none               | Mermaid was re-initialized for a new theme    | arch |
| `app:ready`      | none               | boot finished (data loaded, first doc open)   | arch |

`events.on(name, fn)` returns an unsubscribe function.

### Preview pipeline (`Seq.preview`)

The live preview and the off-screen renderer (used by exports) run the same pipeline:

1. **Transforms** `addTransform(name, fn(model) → copy | null, order)` change a *copy* of the model
   before it is serialized for Mermaid. They never change what's in the editor. Return `null` for "no
   change". A transform also receives `ctx = { live }`; `live` is true only for the on-screen preview, so
   session-only choices don't leak into exports of other diagrams. Built in: `ref-expand` (5),
   `placeholders` (10), `ref-markers` (20).
2. Mermaid renders the SVG.
3. **Decorators** `addDecorator(name, fn(svg, { model, renderModel, settings }), order)` post-process
   the SVG. Built in: `participant-colors` (10), `block-colors` (20), `message-tones` (30), `refs` (40),
   `legend` (50).
   Decorators match SVG elements to the *rendered* model (`renderModel`). It can hold more than the editor
   model, for example expanded references or placeholder notes.

Expanding a reference in the preview uses the same `expandRefs` as inline export, with a
`shouldExpand(note, key)` filter. Every reference note gets a path key (`/pay#1/tds#1`), so nested references
can be toggled one by one. The default comes from the note's `expand` flag. The +/− on the note stores a
session override per diagram.

### Export formats (`Seq.export.registerFormat`)

The export dialog, clipboard copy and folder ZIP export never branch on a format. Each format describes
itself:

```js
Seq.export.registerFormat({
  id: 'pdf', icon: 'file', ext: '.pdf',
  kind: 'image',                         // 'image': from the rendered SVG, 'text': from Mermaid code
  options: (ex, seg) => [...rows],       // optional settings rows
  info: (built) => '…',                  // size label under the preview (image formats)
  toBlob: async (built) => blob,         // file content
  copy: async (built) => 'toast text',   // clipboard
});
```

Add the labels `fmt.<id>` and `fmt.<id>.desc` to `core/i18n.js`.

### Step types (`Seq.steps.register`)

Palette steps (message, reply, note, blocks, …) live in `features/steps.js`. An entry has an `id`,
`icon`, `color` and a `create(ctx)` that returns the new model node (`null` = "needs a participant",
`false` = it already showed its own warning). The palette draws its list from here, and the flow editor
asks it for new nodes. The label key is `step.<id>`.

Steps are drawn in the builder by `flow.js`, which dispatches on the *model* node kind (`message`,
`note`, `activation`, `block`, `raw`). A brand-new node kind also needs parser/serializer support in
`lib/model.js`.

### Diagram check rules (`SeqLint.register`)

`lib/lint.js` holds the rules. They are pure functions of the model, so they are unit tested in Node:

```js
SeqLint.register({
  id: 'myRule', level: 'warning',            // 'error' | 'warning' | 'info'
  check(model, ctx, report) {                // ctx: { docExists(id), selfId }
    // report(uid, params) for each finding; uid = step, branch or participant
  },
});
```

`features/lint.js` runs the rules when the diagram changes, shows the badge and list, and marks the
affected steps. Add the message `lint.<id>` to `core/i18n.js` (params are filled in as `{p}`, `{from}`, `{to}`).

### Keyboard shortcuts (`features/shortcuts.js`)

All global shortcuts are one table. Each row says which keys it matches, which modifiers it needs or
forbids, whether it fires while typing, an optional `when()` condition, and `run(e)`. The first matching
row wins. Other modules can append rows with `Seq.shortcuts.add(row)`.

## Studio directives in Mermaid

The model stores studio-only data as Mermaid comments, so exported code stays valid Mermaid:

| Directive               | Meaning                                                             |
|-------------------------|---------------------------------------------------------------------|
| `%% @color #hex`        | color of the next participant or block                              |
| `%% @role id`           | role of the next participant                                        |
| `%% @roledef id {json}` | role definition, carried along so other workspaces can import it   |
| `%% @item id`           | catalog item of the next participant                                |
| `%% @itemdef id {json}` | catalog item definition (name, role, parent, desc), carried along  |
| `%% @tone name`         | arrow tone of the next message (`success`, `error`, `warning`, `info`) |
| `%% @ref docId [expand]` | the next note links to another diagram; `expand` shows it expanded in the preview by default |
| `%% @auto`              | the following activation lines were generated; a blank line ends the group |

## Roles and catalog

Two separate ideas, chained: **participant → catalog item → role**.

- A **role** (`features/roles.js`) says how a participant looks: shape, color, name prefix/suffix.
- A **catalog item** (`features/catalog.js`) says who it is: `{ id, name, kind, role?, parent?, desc? }`. The
  role is optional. `lookOf(item)` returns the look: from the role if set, otherwise from the C4 `kind`. `parent` builds a C4-style hierarchy, and a parent
  can be a participant too.

Matching (`Seq.catalog.matchesFor`) finds unlinked participants that are probably a catalog item: the
same display name, or the same name once role affixes are removed. Only single, unambiguous matches are
preselected. It feeds the `catalogMatch` lint rule (through `Seq.lint.addRuleUi`, which lets a module add a
description, a one-click fix and context functions to a rule) and the bulk **Link matches** view.

A participant linked to an item takes its role and its name (`composeLabel(role, item.name)`). The name
keeps following the item as long as it wasn't changed in that diagram. `features/library.js` shows both in
one window with two tabs, and `features/defs-notice.js` offers to import unknown roles and items that come
with shared diagrams. When references are expanded inline, participants linked to the same item are merged.

## Architecture screen (C4)

The top bar switches between two screens in the same page: **Flows** (sequence diagrams) and
**Architecture**. Staying in one page keeps a single IndexedDB origin, which separate pages opened from
`file://` would not reliably share.

The architecture screen draws C4 views from two inputs, so it needs no extra maintenance:

- **Elements** come from the catalog. Each item has an explicit C4 type (`kind`): `person`, `system`,
  `container`, `component`, or `group`. Groups only organize the catalog: they are skipped in every view
  and in the breadcrumb, so a catalog with a single root group still gets a proper C1. Expected parents
  (`SeqC4.PARENTS`) are not enforced; a misplaced item is flagged in the catalog and still drawn at the
  nearest sensible level. Items saved before types existed get one once, from their position.
- **Relationships** are derived from the sequence diagrams. Every call between two catalog-linked
  participants is a "uses" relationship (replies and unlinked participants are ignored).

`lib/c4.js` aggregates relationships to the level being viewed. Every item is drawn through its
representative, which is the first non-group item after the common ancestor with the focus. C1 shows persons
and systems. Zooming into an item shows its children inside a boundary, and the neighbors they talk to outside it, at the level just below
the common ancestor (a sibling container in C3, another system in C2). The result is rendered as a Mermaid
flowchart. Sequence diagrams themselves never get extra boxes.

Zoom resizes the SVG itself, so it stays crisp and the scroll container keeps working; a new level is fitted
to the view. `SeqC4.toDrawio(view, layout)` writes an editable draw.io file. The layout (box positions)
is measured from the rendered SVG, the boundary becomes a container with the inner boxes as its children,
and edges are connectors with a source and target.

Each edge also carries the flows it comes from (`flows: [{ doc, texts }]`). Mermaid gives edges the id
`L_<from>_<to>_<n>`; the screen lays a wide transparent hit path over each thin line, so clicking an arrow
or its label lists those flows. Picking one opens the flow and selects the first message of that
relationship.

## Presentation mode

`features/present.js` plays the current flow step by step on a copy of the preview SVG, so colors, tones,
references and the legend look the same. In a sequence diagram time runs top to bottom, so instead of
re-rendering per step, the steps (`[data-et="message"]` lines and note groups) are sorted by their y position,
and a "curtain" rect covers everything below the current step. Upcoming messages, the rest of activation
bars and blocks that haven't started yet are revealed as the curtain moves down. While it is open, the module
handles every key itself, so the app shortcuts don't run.

## State and storage

`Seq.core.S` holds the runtime state: `docs`, `folders`, `roles`, `catalog`, `settings`, the active `doc`, its
parsed `model`, the `code` text and the current `selected` step. `features/editor.js` owns changes to
the model (`commit`, `applyCode`, undo/redo). `features/docs.js` owns opening, saving and persisting
diagrams. `core/storage.js` is the only file that talks to IndexedDB/localStorage.
