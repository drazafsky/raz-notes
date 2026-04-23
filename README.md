# Raz Notes

Offline-first Angular notes application with local-only authentication, optional device unlock, and encrypted storage.

## Features

- Create plain text notes
- Create todo list notes (one item per line)
- Attach any file type to a note (images, videos, audio, PDFs, and more)
- Create a local account and sign in entirely offline
- Optionally enable device-backed unlock (for example biometrics or a passkey prompt) when the browser exposes the required offline WebAuthn capabilities
- Navigate with a shell menu containing Notes and Settings
- Automatically follows the browser light or dark color-scheme preference
- Browse notes on a dedicated list page with created and last-modified timestamps
- Open a note details page to review and edit a note with its fields prepopulated
- Notes and attachments are encrypted locally using a password-protected vault stored in the **Origin Private File System (OPFS)**
- PWA/service worker setup for offline app shell support

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
