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
- **One reason to change.** If a file starts covering two concerns, split it. Shared helpers go to
  `core.js`. Pure logic that doesn't need the DOM goes to `lib/`, where it can be unit tested.

## Extension points

Common changes should only need new code, not edits to existing branches.

### Events (`Seq.core.events`)

The document lifecycle is published as events, so `docs.js` doesn't need to know who cares:

| Event            | Payload            | Emitted when                                  | Listeners |
|------------------|--------------------|-----------------------------------------------|-----------|
| `doc:opened`     | `{ doc }`          | a diagram became the active one               | drawer, refs, roles, versions |
| `doc:leaving`    | `{ doc }`          | before switching away / closing the page      | versions |
| `doc:saved`      | `{ doc }`          | the active diagram was saved                  | versions |
| `doc:deleted`    | `{ id }`           | a diagram was deleted                         | drawer, refs, versions |
| `doc:renamed`    | `{ id, from, to }` | the active diagram's name changed             | refs |
| `docs:persisted` | none               | the workspace was written to storage          | backup |

`events.on(name, fn)` returns an unsubscribe function.

### Preview pipeline (`Seq.preview`)

The live preview and the off-screen renderer (used by exports) run the same pipeline:

1. **Transforms** `addTransform(name, fn(model) → copy | null, order)` change a *copy* of the model
   before it is serialized for Mermaid. They never change what's in the editor. Return `null` for "no
   change". Built in: `placeholders` (10), `ref-markers` (20).
2. Mermaid renders the SVG.
3. **Decorators** `addDecorator(name, fn(svg, { model, renderModel, settings }), order)` post-process
   the SVG. Built in: `participant-colors` (10), `block-colors` (20), `message-tones` (30), `refs` (40),
   `legend` (50).

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
| `%% @tone name`         | arrow tone of the next message (`success`, `error`, `warning`, `info`) |
| `%% @ref docId`         | the next note links to another diagram                              |
| `%% @auto`              | the following activation lines were generated; a blank line ends the group |

## State and storage

`Seq.core.S` holds the runtime state: `docs`, `folders`, `roles`, `settings`, the active `doc`, its
parsed `model`, the `code` text and the current `selected` step. `features/editor.js` owns changes to
the model (`commit`, `applyCode`, undo/redo). `features/docs.js` owns opening, saving and persisting
diagrams. `core/storage.js` is the only file that talks to IndexedDB/localStorage.
