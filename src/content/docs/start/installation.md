---
title: Installation
description: Installing ZenFS and its backend packages.
---

ZenFS is published to NPM as [`@zenfs/core`](https://www.npmjs.com/package/@zenfs/core):

```sh
npm install @zenfs/core
```

That is all you need for the built-in backends. Additional backends are separate packages, installed
alongside `@zenfs/core`:

```sh
npm install @zenfs/dom       # OPFS, IndexedDB, localStorage, XML
npm install @zenfs/archives  # .zip, .iso, .tar
npm install @zenfs/cloud     # Dropbox, Google Drive, S3
npm install @zenfs/linux     # Linux emulation
```

## Bundling

ZenFS exports a drop-in replacement for Node's `fs` module as its default export, so it can be
aliased with the bundler of your choice.

There is also [`@zenfs/bundle`](/bundle), a pre-built bundle of the core and several backends for
use without a build step for prototyping and testing.

## Supporting ZenFS

If you're using ZenFS, especially for big projects, please consider
[supporting the project](https://github.com/sponsors/james-pre). Thousands of hours have been
dedicated to its development. Your financial support would go a long way toward improving ZenFS and
its community.

## Licensing

ZenFS is licensed under the LGPL so that users can always be confident they are using an authenicatic version of ZenFS, and to verify as much.
This doesn't prevent you from bundling or distributing ZenFS. See [copying.md](https://github.com/zen-fs/core/blob/main/COPYING.md) for more info.
