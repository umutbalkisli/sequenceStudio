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
    changeset.js           per-entity diff: revisions, tombstones                               → window.SeqChangeset
  core/                    shared infrastructure
    i18n.js                Turkish/English strings                                              → window.SeqI18n
    icons.js               inline SVG icons                                                     → window.SeqIcons
    storage.js             local storage adapter: IndexedDB (localStorage fallback), versions   → window.SeqStorage
    core.js                DOM helpers, app state S, settings, modal/toast, event bus           → Seq.core
    user.js                user identity (id, optional name)                                    → Seq.user
    repo.js                repository: the only door to persistence, permission guard, status  → Seq.repo
    router.js              hash routes → screens (deep links, back/forward)                    → Seq.router
  data/templates.js        starter diagrams
  features/                one file per feature                                                 → Seq.<feature>
  main.js                  initializes the features in order, then boots
tests/
  unit/                    node:test tests for lib/
  e2e/                     Playwright tests against index.html (file://)
```

## Screens and routing

The app is still a single page, because pages opened from `file://` don't reliably share IndexedDB.
Every screen has an address, though, so deep links and the browser's back and forward buttons work:

| Route | Screen | Module |
|---|---|---|
| `#/flows` | Flow library: folder tree, sortable table, search, filter by catalog item, bulk move/delete | `features/flows-page.js` |
| `#/flows/<id>` | Flow editor: palette, builder/code, preview | `features/layout.js` (registers it) |
| `#/catalog`, `#/catalog/<id>`, `#/catalog?match=1` | Catalog: tree + item detail (usage, relationships, children) / bulk linking | `features/catalog-page.js` |
| `#/architecture[/<focus>]` | C4 views | `features/architecture.js` |
| `#/settings[/general\|roles\|data]` | Language and theme, roles, backup and restore | `features/settings-page.js` |

A screen registers itself with `Seq.router.register({ id, nav, pattern, params, mount, update, unmount })`.
Adding a screen doesn't touch existing code. The router marks the active screen on `<body>` as
`screen-<id>`. CSS hides editor-only parts (`.tb-doc-only`, `#editorBody` with the palette and workspace) on the other screens, and
the shortcut table runs rows without `global: true` only in the editor.

`Seq.router.go(path)` navigates and mounts **synchronously**, so "open this flow, then reveal that
participant" works in a single call; `openFlow(id)` is the usual shortcut. Opening another document in
the editor updates the address (`doc:opened`), and creating one (`doc:created`) switches to the editor.
Share links (`#s=…`) don't clash with routes (`#/…`).

Pages re-render when data changes (`docs:persisted`, `catalog:changed`), but they compare a signature of
the data first. That way a page that has just redrawn itself after its own change doesn't redraw again
under the user's pointer. The architecture view also keeps the SVG when the generated Mermaid code is
unchanged.

The palette sits above the editor (`top`) or in a vertical column on its left (`left`); this is a personal
setting (`S.settings.palPosition`, *Settings › Personal* or the ⇄ button in the palette) that toggles
`body.pal-left`. On the left it is only as wide as its content and can collapse to an icon rail
(`S.settings.palRail`, names stay in tooltips). Panes are size containers: their headers hide switch labels
and titles as they get narrow, so the page never scrolls sideways. Elements that only belong to one layout carry `.when-top` / `.when-left`.

Small, in-context tasks stay where the work happens: the catalog picker in the palette, "Save to catalog"
in the participant panel, the "Link" fix in the diagram check and the ⌘K search. The top bar is the same on every screen. The editor adds a flow bar below it
(`#docbar`): the flow's folder path, name, save state and history on the left, the diagram title in the
middle, and undo/redo, templates, import and export on the right. The folder
path (`features/breadcrumb.js`); each folder opens the Flows page filtered to it (`#/flows?folder=<id>`).
Folder operations (create, rename, move, delete) live in `features/folders.js` (`Seq.folders`), without UI.

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
| `doc:opened`     | `{ doc }`          | a diagram became the active one               | backlinks, breadcrumb, defs-notice, refs, versions |
| `doc:leaving`    | `{ doc }`          | before switching away / closing the page      | versions |
| `doc:saved`      | `{ doc }`          | the active diagram was saved                  | versions |
| `doc:deleted`    | `{ id }`           | a diagram was deleted                         | backlinks, lint, refs, versions |
| `doc:renamed`    | `{ id, from, to }` | the active diagram's name changed             | refs, reconcile |
| `docs:persisted` | none               | the workspace was written to storage          | backlinks, backup, breadcrumb, flows page |
| `workspace:changed` | `{ key }`       | workspace name or a look setting changed     | main (preview controls), settings |
| `code:changed`   | `{ src }`          | the code/model changed (any source)           | lint |
| `builder:rendered` | none             | the builder's step list was redrawn           | lint |
| `catalog:changed` | none              | the catalog was edited                        | arch, reconcile |
| `roles:changed`  | none               | the roles were edited                         | reconcile |
| `repo:status`    | `{ state, error? }`| a write started (`saving`), finished (`saved`) or failed (`error`) | docs (save indicator) |
| `repo:remote`    | `{ type, records }`| another tab (in the cloud: another member) changed records | sync |
| `repo:stale`     | none               | the database was upgraded in another tab; this tab must reload | sync |
| `user:changed`   | none               | the user's display name changed               | — |
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
keeps following the item as long as it wasn't changed in that diagram. The catalog has its own page
(`features/catalog-page.js`) on top of the item operations in `features/catalog.js` (`createItem`,
`updateItem`, `moveItem`, `removeItem`, import/export; edits propagate to diagrams after a short debounce).
Roles live under Settings. `features/defs-notice.js` offers to import unknown roles and items that come with
shared diagrams. When references are expanded inline, participants linked to the same item are merged.

## Architecture screen (C4)

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

## Workspace

All content belongs to a **workspace**: flows, folders, roles, the catalog, and the diagram look (Mermaid
theme, bottom headers, legend). Personal preferences (language, app theme, layout, panel state) don't belong
to it. They stay in `S.settings` (localStorage) and are per user and per device.

- **Local edition:** there is exactly one workspace, `{ id: 'local', kind: 'local' }`. It is created on
  first start, and the user can rename it but can't create another one. The badge next to the logo shows it,
  and its settings live under *Settings › Workspace*.
- **Cloud edition (planned):** the same model holds several workspaces, shared among their members. The
  badge becomes a switcher.
- **Storage:** every record carries its workspace id (`ws`, see *Entity storage* below). Workspace records
  (`{ id, kind, name, role, settings }`) live in the global `workspaces` key of the `kv` store.
- **API:** `features/workspace.js` (`Seq.workspace.get/set/rename/load`) reads and writes workspace
  settings and emits `workspace:changed`. On first start it moves the look settings that earlier versions
  kept in personal settings.
- **Permissions:** the workspace record's `role` (`owner` | `editor` | `viewer`) decides what the user may
  do: `Seq.workspace.can('edit' | 'admin')`. `edit` covers content; `admin` covers the workspace record
  (name, diagram look) and *Replace all* from a backup. Locally the user is the owner; in the cloud the role
  comes from the membership. An unknown role falls back to `viewer` (fail closed); only a local workspace
  with no role at all counts as owner. Without `edit` the app runs **read-only**: `body.readonly` hides or
  locks the editing UI (`.edit-only`, palette, builder, code editor, catalog form, locked settings sections),
  mutating functions start with `Seq.workspace.editable()` (which refuses with a toast), and `Seq.repo`
  doesn't write. Without `admin` the look controls in the preview header are disabled.
- **Workspace record metadata:** saving the record bumps `meta.rev` (read from the stored record) and sets
  `updatedAt`/`updatedBy`.
- **Personal view state stays personal:** whether a folder is expanded lives in `S.settings.foldersCollapsed`,
  not in the shared folder record (older records are migrated on start).
- **Backups:** a backup carries the workspace (`name`, `settings`). Restoring binds the flows to the active
  workspace, and *Replace all* also restores the name and look.

## State and storage

`Seq.core.S` holds the runtime state: `workspace`, `docs`, `folders`, `roles`, `catalog`, `settings` (personal), the active `doc`, its
parsed `model`, the `code` text and the current `selected` step. `features/editor.js` owns changes to
the model (`commit`, `applyCode`, undo/redo). `features/docs.js` owns opening, saving and persisting
diagrams.

### Repository (`Seq.repo`)

Features never touch storage directly; they call `Seq.repo` (`saveDocs`, `saveFolders`, `saveRoles`,
`saveCatalog`, `saveWorkspace`, `versions.list/add/remove/removeAllOf`, `meta`, `deleted`, `estimate`…).
The repository forwards to an **adapter**. The local edition's adapter is `core/storage.js`; a cloud edition
adds a server adapter with the same contract (documented at the top of `core/repo.js`) and the features stay
unchanged. The repository also:

- refuses writes the user isn't allowed to make (`edit` for content, `admin` for the workspace record);
- **coalesces writes:** saves to the same collection within 400 ms become one write (so typing a name is one
  revision, not one per key); pending writes are started right away when the page is hidden or closed, and
  `flush()` waits for them;
- stamps version records with the author (`by`); the adapter adds the workspace (`ws`);
- publishes the write state as `repo:status` (`saving` → `saved`, or `error` until the next successful data
  write). The flow bar's save indicator listens to it;
- publishes changes made elsewhere as `repo:remote` and an outdated tab as `repo:stale` (see below).

### Changes from elsewhere (`features/sync.js`)

After every successful write the local adapter tells other tabs which records changed (`BroadcastChannel`).
The receiving tab reads those records, updates its "last written" state (so its next write builds on them
instead of overwriting them with an older revision) and emits `repo:remote`. A cloud adapter emits the same
event for changes made by other members. `features/sync.js` applies the records item by item:

- folders, roles and the catalog are updated in place, added or removed, and ordered by the stored position;
  unsaved changes to other items in this tab are kept;
- a flow that isn't open is updated in place; the open flow is reloaded if this tab has no unsaved changes,
  otherwise a conflict bar asks: *Load the other tab's version* or *Keep mine* (which writes a new revision on
  top). "Unsaved" means the editor is ahead of the flow, or the flow differs from what this tab last wrote
  (`record.prevJson`);
- the workspace record (name, look, role) is applied.

When another tab opens a newer database version, this tab closes its connection so the upgrade isn't
blocked, and shows a reload banner (`repo:stale`). A tab waiting for an upgrade waits up to 15 s before it
falls back.

### Entity storage (IndexedDB v4)

Flows, folders, roles and catalog items are stored **one record per item** in the `entities` store
(index `ws`), so a change writes only that item and a future sync can merge per item:

```
{ key: "<ws>|<type>|<id>", ws, type: 'doc' | 'folder' | 'role' | 'catalog', id, pos, data, meta }
meta = { rev, createdAt, createdBy, updatedAt, updatedBy, deleted? }
```

`lib/changeset.js` compares the last written state with the new list: new or changed items get `rev + 1`,
`updatedAt` and `updatedBy` (the user id from `Seq.user`); an item that left the list is not removed but
leaves a **tombstone** (`deleted: true`, `data: null`), so another device can learn that it was deleted.
`pos` keeps the order of folders, roles and the catalog; flows are unordered (`ordered: false`).
The `kv` store keeps only small global values (`migrated`, `workspaces`, `ws:<id>:rolesInit`), and
`versions` keeps the history (each version carries its `ws`).

Upgrades run in one versionchange transaction, so either all of them apply or none: v2 adds `versions`,
v3 binds data to the local workspace, v4 moves the `docs` store and the `kv` lists into `entities`
(the old store and keys are removed). If IndexedDB can't be opened, the adapter falls back to plain
localStorage lists (no metadata).

### IDs and identity

Catalog item and role IDs are a slug of the name plus a random suffix (`ledger-k3f9`, `Seq.core.uniqueId`),
so two people creating "Ledger" at the same time never collide. Flow and folder IDs are time-based random
strings. `core/user.js` gives every browser a user id (`seqstudio.user` in localStorage) and an optional
display name (*Settings › Personal*); in the cloud both come from the signed-in account.

### Lazy propagation (`features/reconcile.js`)

Renaming a catalog item, changing a role, or renaming a flow doesn't rewrite the other flows; in a shared
workspace one change would otherwise touch hundreds of records and cause conflicts. Instead, definitions
keep a short history (`item.past`, `role.past`, `doc.past`, at most 10 entries), and flows are adapted when
they are read:

- A participant linked to an item takes the new name if its label is one of the item's old or current names
  (with old or current role affixes). It takes the new look if its look was one of the old looks. Labels and
  looks that were changed by hand stay.
- A participant with only a role gets the new look the same way. Its label is rewritten with the new affixes
  if it was written with old ones.
- A link to a deleted item or role (tombstone) is removed.
- A reference note whose text is one of the target flow's old names takes the new name.

The open flow is adapted right away. Other flows are adapted when opened (`docs.openDoc`, then saved) and,
in memory, whenever they are read through `Seq.core.docCode` (preview, architecture view, exports, search),
which is memoized until a definition changes.
