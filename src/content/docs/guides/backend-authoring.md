---
title: Writing a backend
description: How to implement your own backend for ZenFS.
---

:::note
This guide is a work in progress. The [Backends](/core/backends/) and
[Internal API](/core/internal/) pages cover the concepts in the meantime, and the
[reference](/core/reference/) documents every type mentioned here.
:::

A backend is two things:

1. a `FileSystem` implementation that does the actual work, and
2. a `Backend` object that describes how to configure and construct it.
