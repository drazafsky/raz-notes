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

## AWS deployment

The app is a static Angular SPA, so the recommended AWS shape is:

- private **S3** bucket for the built files
- **CloudFront** distribution in front of the bucket
- **ACM** certificate for the custom domain
- **Route 53** hosted zone for DNS

Deep-link refreshes like `/notes/123` require CloudFront to serve `index.html` for SPA routes.

### Manual deploy script

This repo includes a manual deploy script that:

1. runs `npm ci`
2. runs `npm run build`
3. looks up the CloudFront distribution, S3 bucket, and Route 53 hosted zone from AWS when those flags are not provided
4. creates the S3 bucket if it does not already exist
5. syncs `dist/raz-notes/browser` to S3
6. invalidates the CloudFront cache
7. creates or updates Route 53 alias records for the configured domain

Run it with:

```bash
npm run deploy:aws -- --domain <domain>
```

Example:

```bash
npm run deploy:aws -- --domain notes.example.com
```

Optional flags:

- `--bucket <name>` to override the discovered S3 bucket
- `--distribution-id <id>` to override the discovered CloudFront distribution
- `--hosted-zone-id <id>` to override the discovered Route 53 zone
- `--profile <name>` to use a named AWS CLI profile
- `--region <name>` to force an AWS region for commands that need one and for bucket creation
- `--distribution-domain <dns>` to bypass the CloudFront lookup, useful for dry runs
- `--skip-install` to skip `npm ci`
- `--skip-build` to reuse an existing build
- `--dry-run` to print commands without executing them

Environment variables may be used instead of flags:

- `AWS_DEPLOY_BUCKET`
- `AWS_DISTRIBUTION_ID`
- `AWS_DISTRIBUTION_DOMAIN`
- `AWS_DEPLOY_DOMAIN`
- `AWS_HOSTED_ZONE_ID`
- `AWS_PROFILE`
- `AWS_REGION`
- `AWS_DEFAULT_REGION`

### Prerequisites

Before running the script, make sure:

1. the CloudFront distribution already exists
2. the Route 53 hosted zone already exists
3. the CloudFront distribution is configured with the custom domain and ACM certificate
4. an AWS region is available through `--region`, `AWS_REGION`, `AWS_DEFAULT_REGION`, or AWS CLI config if the bucket may need to be created

The script manages AWS lookups, bucket creation, deploy-time publishing, and DNS updates. It does not create the CloudFront distribution, hosted zone, or certificate.

## Git hooks

Pre-commit checks run automatically through Husky and `lint-staged`. Staged source and config files are formatted and linted before a commit is created.
