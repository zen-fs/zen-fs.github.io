---
title: Devices and drivers
description: Devices, drivers, buses, classes, and the device tree.
---

:::note
`@zenfs/linux` is still being developed and the API is not completely stable yet.
:::

The driver system is modeled on Linux's, so most of it carries over.
A `Device` is a thing that exists, a `DeviceDriver` is the code that knows what to do with it,
and a `BusType` is what decides which drivers are allowed to handle which devices.
A `Class` says what a device _is_, which is what gives it a name under `/dev`.

Registering is what makes any of it happen.
Registering a device looks for a driver, and registering a driver looks for devices,
so the two can show up in either order.

## Devices

A device needs a name, or a bus with a `dev_name` and an `id` to build one from:

```ts
import { Device } from '@zenfs/linux';

const device = new Device({ name: 'example0', bus: platform_bus_type });
device.register();
```

The constructor throws `EINVAL` if it can't work out a name, and `register` throws `EEXIST`
if the device is already registered or something else already has that name where it is going.

Where it goes in `/sys` is worked out from what the device has, in this order:

| The device has          | Where it lands                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `kobj_parent`           | Wherever that says                                                                  |
| A class, and no parent  | `/sys/devices/virtual/<class>/<name>`                                               |
| A class and a parent    | Under the parent, in a `<class>` directory unless the parent has a class of its own |
| A bus with a `dev_root` | Under the bus' root device                                                          |
| A parent                | Under the parent                                                                    |
| Nothing else            | `/sys/devices/<name>`                                                               |

`kobj_parent` is the escape hatch, like setting `dev->kobj.parent` before `device_add` in Linux.
This is how a bus' root device ends up somewhere like `/sys/devices/system`.

`unregister` unbinds the device from its driver, takes away its nodes and links, and removes it from sysfs.
It does nothing if the device was never registered, so it is safe to call in teardown paths that may not have gotten that far.

Attributes come from four places and are merged in this order, so the device's own `attrs` win:
the bus' `dev_attrs`, the class' `dev_attrs`, the type's `dev_attrs`, then `attrs`.

`driver_data` is where a bound driver keeps whatever it needs with the device.
The xterm driver keeps the tty it created there:

```ts
function xterm_probe(device: PlatformDevice): boolean {
	const node: DeviceTreeNode | undefined = device.of_node;
	if (node?.kind != 'xterm') return false;

	device.driver_data = attach_xterm(node.terminal, { index: free_index(), ...node.options });
	return true;
}
```

## Device numbers

A device number is a `DevT`, which is a major and a minor. 20 bits of a packed number are the minor,
the same sizes that Linux uses. `toDev`, `fromDev`, and `format_dev_t` convert between the forms.

Giving a device a `dev_t` is what makes it a device in the `/dev` sense. On registration it gets:

- a `dev` attribute holding `<major>:<minor>`
- a link in `/sys/dev/char` or `/sys/dev/block`, depending on whether its class is `block`
- a node in devtmpfs

The node's name and mode come from `dev_node`, which is first looked for in the device's type and then in the class. Without either, the name is the device's own with `!` turned into `/`; this is how a device gets a node in a subdirectory.

```ts
export const mem_class = new Class('mem', {
	dev_node: device => ({ mode: device.dev_t && dev_list[device.dev_t.minor]?.mode }),
});
```

## Buses

A `BusType` is a kobject at `/sys/bus/<name>` with a `devices` and a `drivers` directory under it.
It owns the matching policy for everything on it:

```ts
platform_bus_type = new BusType<PlatformDevice, PlatformDriver>('platform');
platform_bus_type.match = platform_match;
platform_bus_type.remove = platform_remove;
platform_bus_type.shutdown = platform_shutdown;
```

`match` decides whether a driver may handle a device. A bus without one accepts every pairing, like Linux.
The platform bus tries `driver_override` first, then the device tree, then the driver's `id_table`,
and finally falls back to the device and driver having the same name.

`remove`, `shutdown`, `online`, `offline`, `suspend`, and `resume` are the bus-wide hooks.
`remove` is only consulted when the driver doesn't have its own.

`dev_name` and an `id` on a device are how buses name devices for you, e.g. `cpu` and `0` giving `cpu0`.
`subsys_system_register` gives a bus a root device at `/sys/devices/system/<name>` that its parentless devices go under.

## Drivers

A driver has a name, a bus, and a `probe`:

```ts
import { PlatformDriver } from '@zenfs/linux';

const driver = new PlatformDriver({
	name: 'example',
	of_match_table: ['example'],
	probe(device) {
		device.driver_data = something(device);
		return true;
	},
	remove(device) {
		delete device.driver_data;
	},
});

driver.register();
```

`probe` returns whether the driver is taking the device.
Returning `false` leaves the device unbound and lets the next driver have a look,
and throwing does the same but propagates, so use `false` when the driver shouldn't control the device.
A driver with no `probe` at all takes every device the bus matched for it.

`register` creates `/sys/bus/<bus>/drivers/<name>`, then offers the driver every unbound device on the bus.
It throws `EEXIST` if the driver is already registered or the bus already has one by that name.
`unregister` unbinds every device the driver holds and undoes the rest.

Unless `disableSysfsBind` is set, a registered driver gets `bind` and `unbind` attributes that take a device name,
so a device can be moved between drivers from userspace. `bind` throws `ENODEV` when there is no such device on the bus
or the bus won't match it, and `EBUSY` when the device already has a driver.

Set `owner` to the module the driver belongs to. See [Kernel modules](/linux/modules/) for more info.

## Binding

Binding is the same code path from both ends.

`Device.register` calls `attach`, which goes through the bus' drivers, skips the ones `matches` rejects,
and offers the device to each one with `try_bind` until one takes it.
`DeviceDriver.register` calls its own `attach`, which goes through the bus' devices and offers itself to the unbound ones.

Either way, a successful `try_bind` sets the device's `driver`, creates a `driver` link on the device and a
link back on the driver, and sends a `bind` uevent. `release_driver` undoes all of it and sends `unbind`.

The manual controls are `bind_driver`, which skips probing entirely and throws `EBUSY` if the device is already bound,
and `release_driver`, which does nothing if it isn't.

## Classes

A `Class` is a kobject at `/sys/class/<name>`. Devices with one are linked into it,
get a `subsystem` link pointing back at it, and live in `/sys/devices/virtual/<name>` when they have no parent.

```ts
export const mem_class = new Class('mem', { dev_node: ... });
```

A `DeviceType` is the finer-grained version, similar to Linux's `dev->type`.
It contributes `dev_attrs`, gets first say in `dev_node`, and can add variables to the device's uevents.

## Character devices

Publishing operations for a major is one call:

```ts
import * as char_dev from '@zenfs/linux';

const major = char_dev.register(0, 'example', ops);
```

A major of `0` allocates one, and the one that ended up being used is returned.
This reserves all 256 minors of that major, which is `register_chrdev`.
`char_dev.unregister(major, name)` undoes it, and throws `EINVAL` if that major isn't registered under that name.

For finer control there is `CharDevice`, which publishes `ops` for a range of numbers with `add(dev, count)`
and stops with `del`. `add` throws `EBUSY` if any number in the range already has a driver,
and after `del` any node still referring to those numbers fails to open with `ENXIO`.

[`FileOperations`](https://zenfs.dev/linux/reference/interfaces/fileoperations/) is what the VFS ends up calling. There is no way to report a short read, since `FileSystem.read` has no way to report one either.

The memory devices are the smallest complete example. They all share major 1, so the operations
look the real device up by minor on every call:

```ts
const dev_list: Record<number, MemDevice> = {
	3: { name: 'null', ops: { read() {}, write() {} }, mode: 0o666 },
	5: { name: 'zero', ops: { read: (file, buffer, start, end) => buffer.fill(0, 0, end - start), write() {} }, mode: 0o666 },
	// ...
};

export function char_dev_init(): void {
	char_dev.register(memMajor, 'mem', memory_ops);

	for (const [minor, dev] of Object.entries(dev_list)) {
		new Device({ name: dev.name, class: mem_class, dev_t: { major: memMajor, minor: +minor } }).register();
	}
}
```

Linux swaps a file's operations in `memory_open`, since it only gets the one chance when the file is opened.
There is no such hook here, so every operation does the lookup.

## The device tree

The device tree is how you tell the kernel what "hardware" exists.
A driver adds the kinds of node it understands by augmenting `DeviceTreeType`, and `kind` is what `compatible` is on Linux:

```ts
declare module '@zenfs/linux' {
	interface DeviceTreeType {
		xterm: { terminal: XTermLike; options?: AttachXTermOptions };
	}
}
```

Nodes are described with `define_device_tree` and matched by a driver's `of_match_table`:

```ts
import { define_device_tree } from '@zenfs/linux';

define_device_tree({ kind: 'xterm', terminal });
```

Each node becomes a platform device under `/sys/devices/platform`, with an `of_node` directory holding
its `name` and `compatible`. A node without an `id` gets one counted off as `<kind>.<n>`,
since nothing here has a `reg` address to build a name out of the way Linux does.

Order doesn't matter. `of_platform_populate` turns everything described so far into devices when the platform bus comes up,
and a node described after that becomes a device immediately, so it binds right away.
`undefine_device_tree` takes nodes back out, unregistering their devices.
