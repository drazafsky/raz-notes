# Raz Notes

Raz Notes is an offline-first note app for creating SVG-based notes with local-only authentication and encrypted local storage.

## Features

- **Offline login and vault access** with no server dependency for account creation or sign-in
- **Encrypted local storage** for notes and attachments using a password-protected vault in the Origin Private File System (OPFS)
- **Optional device-backed unlock** when the browser exposes offline WebAuthn/device credential support
- **SVG canvas notes** with pan, zoom, draggable text elements, resize handles, and inline rich-text formatting
- **Per-selection text styling** including font family, size, color, bold, italic, underline, strikethrough, subscript, and superscript
- **Attachments on notes** with inline viewing for supported file types, including DOCX and XLSX previews
- **Notes list previews** that render each note’s SVG content directly in the list
- **Responsive shell and theming** with automatic light/dark mode based on the browser preference
- **Configurable login timeout** including never-lock and application-unfocus locking modes
- **PWA/offline shell support** via the Angular service worker after the app has been loaded online once and cached locally

## Local development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm start
```

The app runs at `http://localhost:4200/`.

## Quality checks

Format check:

```bash
npm run format:check
```

Lint:

```bash
npm run lint
```

Production build:

```bash
npm run build
```

Unit tests:

```bash
npm test -- --watch=false --browsers=ChromeHeadless
```

## Git hooks

Pre-commit checks run automatically through Husky and `lint-staged`. Staged source and config files are formatted and linted before a commit is created.
