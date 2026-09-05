---
title: Kernel modules
description: The module API — lifecycle, parameters, references, taints, and what a module looks like in sysfs.
---

:::note
`@zenfs/linux` is still being developed and the API is not completely stable yet.
:::

A module is a unit of functionality that can be loaded and unloaded while everything else keeps running.
The API follows Linux closely enough that the concepts carry over:
modules have parameters, take references on each other, carry taint flags,
and show up in `/sys/module` and `/proc/modules`.

There is nothing special about the built-in modules.
`tty` and `webstorage` are ordinary `Module`s that happen to be loaded by `init`,
so anything they do is available to a module you write.

## Lifecycle

A module is in one of four states, which correspond to Linux's `MODULE_STATE_*`:

| State      | `initstate` | Meaning                                              |
| ---------- | ----------- | ---------------------------------------------------- |
| `unformed` | `unknown`   | Constructed, not loaded. Linux has no name for this. |
| `init`     | `coming`    | `init` is running                                    |
| `live`     | `live`      | Loaded                                               |
| `exit`     | `going`     | Being unloaded                                       |

Constructing a `Module` only sets it up; it registers the name, creates `/sys/module/<name>`, and builds the parameters.
Loading is `init()`, and unloading is `dispose()`.
Both are async, unlike Linux's `init_module(2)` and `delete_module(2)`,
since a module may need to do something asynchronous (like fetching a resource) before it is ready.
The module sits in `init` until then.

```ts
import { Module } from '@zenfs/linux';

const example = new Module({
	name: 'example',
	version: '1.0.0',
	license: 'LGPL-3.0-or-later',
	description: 'Does something useful',
	init() {
		// register whatever the module provides
	},
	exit() {
		// and undo it here
	},
});

await example.init();
```

If `init` throws, the module is torn down and the error is rethrown, so a failed load doesn't leave a half-registered module behind.
That only covers the module's own bookkeeping though; whatever `init` had already registered before it threw is still registered, so `init` needs to clean up after itself:

```ts
init() {
	major = block_dev.register(0, 'example');

	try {
		driver = new PlatformDriver({ name: 'example', probe, remove });
		driver.register();
	} catch (e) {
		block_dev.unregister(major, 'example');
		throw e;
	}
}
```

Modules are `AsyncDisposable`, so `await using` works if the lifetime is scoped:

```ts
await using example = new Module({ name: 'example' });
await example.init();
```

This only works if the module actually reaches `live` though, since `dispose()` without `force` is used.

Note the constructor throws `EINVAL` without a name and `EEXIST` if a module by that name already exists,
and that `dispose` frees the name and tears down the sysfs entries.
A disposed module is gone so you need to construct a new one rather than calling `init` again.

Anything that wants to know about loads and unloads can add a `ModuleNotifier` to `module_notifiers`,
which is called on every state change. `modules` is a read-only map of every module that currently exists,
including ones that aren't live yet, and `find_module(name)` is the lookup.

## Parameters

Parameters are declared with `params`, and their type comes from the initial value:

```ts
new Module({
	name: 'webstorage',
	params: {
		/** How big each disk is, in KiB. Read when the driver probes. */
		size: { value: 1024 },
		/** What the driver's keys start with, so it doesn't tread on anything else using the area */
		prefix: { value: 'zenfs.' },
		debug: { value: false, changed: value => console.log('debug is now', value) },
	},
});
```

`string`, `number`, and `boolean` are the supported types. Assigning a value of a different type throws `EINVAL`.

Read them back with `mod.param(name)`, which is shorthand for `mod.params.get(name)?.value`:

```ts
const capacity_kib = web_storage.param<number>('size')!;
```

Each parameter is an attribute in `/sys/module/<name>/parameters`, with a mode of `0o644` by default.
A mode of `0` keeps the parameter out of sysfs entirely, which is what you want for something that
should only be set from the command line. Writing to a parameter without a write bit throws `EPERM`.

Values are parsed the way Linux parses them, not the way `JSON.parse` would:
booleans show as `Y` or `N` and accept `y`/`n`, `1`/`0`, `on`/`off`, `true`/`false`, and `enable`/`disable`;
numbers accept a sign, `0x` for hex, and a leading `0` for octal.

`changed` is called after a parameter is written **through sysfs**. Setting `param.value` directly doesn't call it,
so a module that needs to react to its parameters changing should read them at the point of use where it can.

Parameters can also be set on the kernel command line as `<module>.<param>=<value>`:

```ts
await init({ cmdline: 'init=/bin/sh quiet tty.probe=0' });
```

The command line is parsed before the built-in modules are loaded, and, like Linux, a parameter for a
module that doesn't exist yet is quietly ignored rather than being an error. An unknown parameter on a
module that _does_ exist is warned about and dropped.

## References and dependencies

A module that is in use can't be unloaded. `try_ref` takes a reference and returns whether it succeeded; it fails unless the module is `live`. `ref` is the same thing but throws `EBUSY` while the module is still loading and `ENOENT` otherwise.
`unref` releases one and `refcnt` is the current count.

Depending on another module is `use`, which takes the reference for you and records the relationship in both directions:

```ts
example.use(web_storage);
```

That puts `web_storage` in `example.uses`, puts `example` in `web_storage.holders`,
and creates the link `/sys/module/webstorage/holders/example`. `unuse` undoes all of it.
Unloading drops everything a module uses and everything using it, so you don't have to unwind the graph by hand.

`dispose()` throws `EBUSY` if the module still has references. Passing `force` unloads it anyway and taints it with `F`:

```ts
await web_storage.dispose(true);
```

## Taints

Taints are a set of flags on the module, keyed by the same characters Linux uses:

| Flag | Meaning     |
| ---- | ----------- |
| `P`  | proprietary |
| `F`  | forced load |
| `C`  | staging     |
| `E`  | unsigned    |
| `O`  | out-of-tree |

Set them at construction with `taints`, read them back as a set from `taints`, or as the string Linux prints
from `flags`. `F` is the only one applied automatically, by a forced unload.

## What a module looks like in sysfs

`/sys/module/<name>` holds:

| Entry         | Mode    | Contents                                |
| ------------- | ------- | --------------------------------------- |
| `initstate`   | `0o444` | The state, using Linux's names          |
| `refcnt`      | `0o444` | `refcnt`                                |
| `taint`       | `0o444` | `flags`, e.g. `OE`                      |
| `version`     | `0o444` | Only present if `version` was given     |
| `srcversion`  | `0o444` | Only present if `srcversion` was given  |
| `uevent`      | `0o200` | Write to send a uevent                  |
| `holders/`    |         | A link per module using this one        |
| `parameters/` |         | The parameters with a non-zero mode     |
| `drivers/`    |         | A link per driver the module registered |

`parameters` and `drivers` are only created once something goes in them, the same as on Linux.

An `add` uevent is sent when the module goes live and a `remove` uevent when it starts unloading,
both with `MODULE` set to the module's name.

`/proc/modules` has a line per module. Linux prints the size in bytes and the load address; neither
means anything here, so both are `0`:

```
webstorage 0 0 - Live 0x0000000000000000
tty 0 1 example, Live 0x0000000000000000 (O)
```

## Registering with the kernel

Most modules exist to register something, like a driver, disk, or character device.
The registration itself belongs in `init` and the matching teardown in `exit`, in reverse order.

Drivers have an `owner`, which is what ties them to the module:

```ts
console_driver.owner = tty;
console_driver.register();
```

With `owner` set, registering the driver creates `/sys/module/tty/drivers/<bus>:<driver>` and a `module`
link pointing back the other way, so the relationship is visible from both ends.

A driver can also name its module with `mod_name` instead, which is resolved with `find_module` when it registers.
This is for drivers built into a module that isn't constructed yet.

Block devices take the module directly as `owner` in `GenDiskInit`.
