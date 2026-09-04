---
title: Quick start
description: Reading and writing your first files with ZenFS.
---

With `@zenfs/core` installed, you can start using `fs` immediately. A single `InMemory` backend is
created by default and mounted on `/`, so nothing needs to be configured first:

```js
import { fs } from '@zenfs/core'; // You can also use the default export

fs.writeFileSync('/test.txt', 'You can do this anywhere, including browsers!');

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```

## Persistance

In-memory storage is cleared when the runtime ends. To keep data around, use a
backend that persists its data. For example, `WebStorage` from `@zenfs/dom`:

```js
import { configureSingle, fs } from '@zenfs/core';
import { WebStorage } from '@zenfs/dom';

await configureSingle({ backend: WebStorage });

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This will persist across reloads!');
}

console.log(fs.readFileSync('/test.txt', 'utf-8'));
```

## Using promises

The `node:fs/promises` API is exposed as `promises`, and can be imported directly:

```js
import { configureSingle } from '@zenfs/core';
import { exists, writeFile } from '@zenfs/core/promises';
import { IndexedDB } from '@zenfs/dom';

await configureSingle({ backend: IndexedDB });

if (!(await exists('/myfile.txt'))) {
	await writeFile('/myfile.txt', 'Lots of persistent data');
}
```

You can also import it using the named `promises` export or by accessing `fs.promises`.

## Next

- [Using ZenFS](/guides/using-zenfs/) covers mounting multiple backends, the promises API, and mounting at runtime.
- [Configuration](/core/configuration/) has many details for `configure`.
- The [playground](/playground/) lets you try backends and configurations without installing anything.
