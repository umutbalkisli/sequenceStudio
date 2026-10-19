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
- **Strings** go to both languages in `core/i18n.js`.
- **Every behavior change gets a test.** A bug fix gets a test that would have caught it.
- Match the surrounding style: small functions, short doc comments on anything public.
