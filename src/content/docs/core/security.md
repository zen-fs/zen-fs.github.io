---
title: Security
description: Credentials, permissions, contexts, and chroot.
---

ZenFS implements Unix-style credentials and permissions at the VFS level,
along with contexts and `chroot` for restricting what a piece of code can see.
All of it is checked before a backend is ever touched,
so it works the same regardless of what you have mounted.

## What this actually protects against

:::caution
Since ZenFS runs entirely in your own process, this is **not** a security boundary.
:::

Everything shares one ES realm.
Any code that can `import '@zenfs/core'` gets the same VFS you have and can call `configure` to make itself root.

So, permissions are for modeling a system and catching mistakes and not for containing code that is actively trying to get out.
A real boundary has to come from the platform, you might choose to run the untrusted code in a worker or an iframe and keep ZenFS on the other side of it.
The proposed [`Compartment`](https://github.com/tc39/proposal-compartments) API would be a perfect fit, though for now a `ses` polyfill is the best we can do.

Note that ZenFS is designed to be used with a _single import per ES realm_.
Two copies means two unrelated VFSs, each with their own mounts and credentials.

## Credentials

Credentials are modeled on Linux's [`cred` struct](https://github.com/torvalds/linux/blob/master/include/linux/cred.h):
`uid`, `gid`, the saved and effective versions of both, and a list of supplementary `groups`.
`createCredentials` fills in the effective and saved ids from `uid` and `gid`, so most of the time you only set those two.

The global context starts as root, which means every permission check passes until you say otherwise:

```ts
await configure({ mounts: { '/': InMemory }, uid: 1001, gid: 1001 });
```

Every call to `configure` resets the global credentials, so `configure({})` puts you back at uid 0. If you drop privileges and then reconfigure a mount later, set `uid` and `gid` again.

## Permissions

Mode bits work the way you would expect: the VFS checks owner, then group, then other, and throws `EACCES` if the requested access isn't granted. A few details are worth knowing:

- Root (an effective uid or gid of 0) bypasses the checks, except that executing a non-directory still requires at least one execute bit to be set. This is the same rule Linux uses.
- Symlinks always pass. Permissions on the target are what matter.
- Membership in `groups` counts for the group bits, not just a matching `gid`.

Checks can be turned off entirely with `disableAccessChecks`, which is worth doing if you aren't using permissions since it can lead to a small performance improvement:

```ts
await configure({ mounts: { '/': InMemory }, disableAccessChecks: true });
```

## Contexts

A context is a view of the file system tree. Each one has its own root directory, working directory, credentials, open file descriptors, and mount table. `bindContext` gives you back a copy of the API bound to it:

```ts
import { bindContext, fs } from '@zenfs/core';

fs.mkdirSync('/jail');

const jail = bindContext({ root: '/jail', credentials: { uid: 333, gid: 333 } });

jail.fs.writeFileSync('/duck.txt', 'Quack!');

console.assert(fs.readFileSync('/jail/duck.txt', 'utf8') === 'Quack!');
```

Anything the bound context creates is owned by the context's credentials, and paths inside it are resolved against its root. There is no way to name `/jail`'s parent from inside `jail`. `jail.path` is bound the same way, and `jail.bind(...)` creates a child context with `jail` as its parent.

Credentials go under `credentials`, not at the top level. `bindContext({ root: '/jail', uid: 333 })` silently does nothing, since `ContextInit` has no `uid`.

Each context has its own descriptor table, so an fd from one is meaningless in another.

## `chroot`

`chroot` changes a context's root to a path underneath its current one. It requires root credentials, which is what keeps code that has already been confined from confining itself somewhere more convenient:

```ts
import { bindContext, chroot } from '@zenfs/core';

const ctx = bindContext({ root: '/' });

chroot.call(ctx, '/jail');

ctx.fs.readdirSync('/'); // the contents of /jail
```

It mutates the context and returns nothing. `chroot` isn't part of the bound `fs` object, so call it with the context as `this`; calling the global `fs.chroot` moves the global context's root instead.

The path is resolved against the context's current root and can only go deeper; `chroot.call(ctx, '..')` throws `EPERM`.
If the context has a file descriptor open outside the new root, you get `EBUSY` rather than a handle that points somewhere unreachable.
