# Third-party software notices

Reviewed: 2026-08-08. `package-lock.json` is the reproducible dependency inventory for the source
tree. `THIRD_PARTY_LICENSES.txt` contains the generated license text distributed with the browser
and Worker artifacts. Automated metadata checks support, but do not replace, release-specific legal
review.

## Direct runtime dependencies

| Component | Version | License | Purpose                          |
| --------- | ------: | ------- | -------------------------------- |
| Hono      |  4.13.1 | MIT     | Worker HTTP routing              |
| jose      |   6.2.8 | MIT     | Access JWT and JWKS verification |
| React     |  19.2.8 | MIT     | Browser UI                       |
| React DOM |  19.2.8 | MIT     | Browser rendering                |

No container image, user-code interpreter, model weight, dataset or browser runtime is distributed
by version 0.1.

## Development and build dependencies

Cloudflare Vite Plugin, Cloudflare Workers types, Cloudflare Vitest pool, Vite, Vitest, TypeScript,
Prettier, React Vite plugin and their transitive packages are pinned in the lockfile. Most declare
MIT, Apache-2.0, ISC, BSD, 0BSD or CC0 licenses.

The development graph also contains review-required optional/build packages:

- `lightningcss` and optional platform packages under MPL-2.0;
- `@img/sharp-libvips-*` optional platform packages under LGPL-3.0-or-later;
- `@img/sharp-wasm32` with Apache-2.0, LGPL-3.0-or-later and MIT declarations; and
- `@img/sharp-win32-*` with Apache-2.0 and LGPL-3.0-or-later declarations.

They are not detected in the emitted Worker JavaScript bundle, but redistribution of a build image,
binary cache or packaged development environment must separately satisfy their notices, source-code
availability and other applicable obligations. Do not infer that Apache-2.0 covers those packages.

## Services and models

Cloud services and hosted model terms are operational inputs, not software redistributed under the
repository license. See `SERVICES_AND_MODELS.md`. A model or provider change requires a new license,
acceptable-use, data-handling, security and cost review.
