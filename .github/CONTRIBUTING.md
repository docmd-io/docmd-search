# Contributing to `docmd-search`


Thank you for your interest in contributing to `docmd-search`! We appreciate all contributions, from bug fixes and documentation improvements to new features and design suggestions.

## Development Environment

`docmd-search` is a monorepo managed with [pnpm](https://pnpm.io/).

### Prerequisites

- **Node.js**: v22.x or later (LTS recommended)
- **pnpm**: v10.x or later

### Project Setup

Clone the repository and set up the development environment:

```bash
git clone https://github.com/docmd-io/docmd-search.git
cd docmd-search
pnpm prep
```

To also link the local `docmd-search` command globally for testing in other projects:

```bash
pnpm prep --link
```

### Local Development

Run the documentation site while watching for changes in the core engine:

```bash
pnpm run dev
```

To watch internal source files (engine, templates, and plugins), set the `DOCMD_DEV` environment variable:

```bash
DOCMD_DEV=true pnpm run dev
```

## Quality Standards

Before submitting a Pull Request, please ensure your changes pass the verification suite:

```bash
pnpm verify
```

### Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/). Please prefix your commit messages with:
- `feat:` (New features)
- `fix:` (Bug fixes)
- `docs:` (Documentation changes)
- `refactor:` (Code changes that neither fix bugs nor add features)

### Source Headers

All new files within the `packages/` directory MUST include the standard project copyright header to maintain consistency and compliance.

```javascript
/**
 * --------------------------------------------------------------------
 * docmd-search : offline semantic search for docs, zero-config.
 *
 * @package     docmd-search (and ecosystem)
 * @website     https://docmd.io/search
 * @repository  https://github.com/docmd-io/docmd-search
 * @license     MIT
 * @copyright   Copyright (c) 2026-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */
```

## GitHub Workflow

1.  **Fork and Branch**: Create a feature branch from the latest `main`.
2.  **Verify**: Ensure `pnpm verify` returns `🛡️ docmd is ready for production!`.
3.  **Pull Request**: Open a PR with a clear description of the problem solved or the feature added.