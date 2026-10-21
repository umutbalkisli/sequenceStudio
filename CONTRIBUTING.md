# Contributing

Thanks for helping out! Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. It explains how the
code is organized and where new features usually go.

## Setup

The app needs no tooling: open `index.html` in a browser. Node.js 20+ is used only for linting and tests:

```sh
npm ci
npx playwright install chromium   # once, for the end-to-end tests
```

## Checks

```sh
npm run lint        # ESLint (catches undefined names across modules)
npm run test:unit   # node:test, lib/ only, takes a second
npm run test:e2e    # Playwright against index.html over file://
npm test            # all of the above; CI runs this on every push and pull request
```

The e2e tests fail on any uncaught page error. To debug one test: `npx playwright test -g "name" --headed`.

## Guidelines

- **No build step and no runtime dependencies.** The app has to keep working from `file://`.
- **Put code where it belongs.** Pure logic goes in `lib/` with a unit test. A UI feature gets its own
  file in `features/` with an `init()`. Use the extension points (events, preview pipeline, export
  formats, step types, shortcut table) instead of adding `if (kind === …)` branches to existing code.
- **New script?** Add it to `index.html` (and to `INIT_ORDER` in `main.js` if it has `init()`).
- **New screen?** Register it with `Seq.router.register` in your module's `init()` and add a `<section>` for it in `index.html`. See *Screens and routing* in the architecture doc.
- **Persistence goes through `Seq.repo`.** Don't call `window.SeqStorage` or IndexedDB from a feature; a cloud
  adapter will replace the local one behind the repository.
- **Changing content?** Start the function with `if (!Seq.workspace.editable()) return …` so read-only
  workspaces stay read-only, and mark creation buttons with the `edit-only` class.
- **Personal view state** (expanded/collapsed, selection, layout) goes to `S.settings`, never into a shared
  record; every change to a shared record is a revision that other people receive.
- **Don't rewrite other flows** when a definition changes; record the old state and let
  `features/reconcile.js` adapt flows when they are read (see *Lazy propagation*).
- **Strings** go to both languages in `core/i18n.js`.
- **Every behavior change gets a test.** A bug fix gets a test that would have caught it.
- Match the surrounding style: small functions, short doc comments on anything public.
