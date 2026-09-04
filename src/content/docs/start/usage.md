---
title: Using ZenFS
description: Mounting one or many backends, the promises API, mounting at runtime, and node module emulation.
---

This is the full usage guide for ZenFS. If you just want to get something running, start with the
[quick start](/start/quick-start/).

## The default filesystem

A single `InMemory` backend is created by default and mounted on `/`, so `fs` works with no setup:

```js
import { fs } from '@zenfs/core'; // You can also use the default export

fs.writeFileSync('/test.txt', 'You can do this anywhere, including browsers!');

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```

## Using different and/or multiple backends

You can configure ZenFS to use a different backend and mount multiple backends. It is strongly
recommended to do so using the `configure` function.

You can use multiple backends by passing an object to `configure` which maps paths to file systems.
The following example mounts a zip file to `/mnt/zip`, in-memory storage to `/tmp`, and IndexedDB to
`/home`. `/` has the default in-memory backend.

```js
import { configure, InMemory } from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';
import { Zip } from '@zenfs/archives';

const res = await fetch('mydata.zip');

await configure({
	mounts: {
		'/mnt/zip': { backend: Zip, data: await res.arrayBuffer() },
		'/tmp': InMemory,
		'/home': IndexedDB,
	},
});
```

You aren't required to use absolute paths for the keys of `mounts`, but it is a good
practice to do so.

:::tip
When configuring a mount point, you can pass in

1. A [`Backend`](/core/reference/interfaces/backend/) object, if the backend has no required options
2. An object that has the options accepted by the backend and a `backend` property which is a
   `Backend` object
3. A [`FileSystem`](/core/reference/classes/filesystem/) instance

:::

If you only need a single backend mounted at `/`, `configureSingle` is more direct. Here is an
example that mounts the `WebStorage` backend from `@zenfs/dom`:

```js
import { configureSingle, fs } from '@zenfs/core';
import { WebStorage } from '@zenfs/dom';

await configureSingle({ backend: WebStorage });

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This will persist across reloads!');
}

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```

For everything `configure` accepts (including permissions), see [Configuration](/core/configuration/).

## FS promises

The FS promises API is exposed as `promises`.

```js
import { configureSingle } from '@zenfs/core';
import { exists, writeFile } from '@zenfs/core/promises';
import { IndexedDB } from '@zenfs/dom';

await configureSingle({ backend: IndexedDB });

if (!(await exists('/myfile.txt'))) {
	await writeFile('/myfile.txt', 'Lots of persistent data');
}
```

:::note
You can import the promises API using:

1. Exports from `@zenfs/core/promises`
2. The `promises` export from `@zenfs/core`
3. `fs.promises` on the exported `fs` from `@zenfs/core`

:::

## Mounting and unmounting, creating backends

If you would like to create backends without `configure` (e.g. to do something dynamic at runtime),
you may do so by importing the backend and calling `resolveMountConfig` with it.

You can then mount and unmount the backend instance by using `mount` and `umount`.

```js
import { configure, resolveMountConfig, InMemory, fs } from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';
import { Zip } from '@zenfs/archives';

await configure({
	mounts: {
		'/tmp': InMemory,
		'/home': IndexedDB,
	},
});

fs.mkdirSync('/mnt/zip', { recursive: true });

const res = await fetch('mydata.zip');
const zipfs = await resolveMountConfig({ backend: Zip, data: await res.arrayBuffer() });
fs.mount('/mnt/zip', zipfs);

// do stuff with the mounted zip

fs.umount('/mnt/zip'); // finished using the zip
```

:::caution
Instances of backends follow the _internal_ API. You should never use a backend's methods unless you
are extending a backend.
:::

## `node:*` emulation

ZenFS also includes emulation of some other `node:` modules for various reasons, importable from
`@zenfs/core/<name>`:

- `node:path`
- `node:readline`

For example:

```ts
import * as path from '@zenfs/core/path';
```

## Bundling

ZenFS exports a drop-in for Node's `fs` module, so you can use it for your bundler of preference
using the default export.
