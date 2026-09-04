---
title: Security
description: Permissions, credentials, chroot, and execution contexts in the VFS.
---

:::caution
Since ZenFS exists purely client-side, this is **not** a true security boundary!
:::

## Overview

Security in ZenFS is handled at the Virtual File System (VFS) level, which checks operations against access controls before interacting with storage backends. ZenFS is designed to be used with a _single import per ES realm_.

## Contexts

Contexts (`FSContext`/`BoundContext`) !!!todo!!! . Each context has its own root directory, working directory, credentials, and open files/fds.

```ts
import { bindContext, fs } from '@zenfs/core';

const ctx = bindContext({ root: '/secure', uid: 333, gid: 333 });

ctx.writeFileSync('/data.txt', 'Restricted Access');

console.log(fs.readdirSync('/secure')); // ['data.txt']
```

## `chroot`

`chroot` in ZenFS is implemented as a shortcut for creating a new execution context or modifying an existing one. The effective uid or gid of the current set of credentials object _must_ be 0, which ensures untrusted code given a `chroot`ed environment cannot escape.

```ts
import { fs } from '@zenfs/core';

const ctx = fs.chroot('/sandbox');
ctx.writeFileSync('/file.txt', 'Restricted');
console.log(ctx.readdirSync('/'));
```

## `configure`

ZenFS allows modifying user and group IDs (UID/GID) through configure. This allows you to use permissions, since by default the root user always has permission. For example:

```ts
await configure({ uid: 1001, gid: 1001 });
```

## Credentials Management

ZenFS maintains an internal credentials system, similar to the Linux `cred` struct, which defines the user and group ownership of operations.
