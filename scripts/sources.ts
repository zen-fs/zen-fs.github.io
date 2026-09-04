#!/usr/bin/env node
/**
 * Populates `.sources/` with the source of each `@zenfs` package, which the API reference is
 * generated from. Run automatically before `astro dev` and `astro build`.
 *
 * By default each package is cloned from GitHub at its latest release tag. Set
 * `ZENFS_LOCAL_SOURCES=1` to symlink sibling checkouts (`../core`, `../dom`, ...) instead, which
 * lets the reference be previewed against uncommitted work.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Package {
	/** Directory under `.sources/`, and the URL segment the package's docs live at. */
	name: string;
	/** Repository within the `zen-fs` organization. */
	repo: string;
	/** Display name, used for the reference's TypeDoc project name. */
	title: string;
}

/** Packages the API reference is generated for, in sidebar order. */
export const packages: Package[] = [
	{ name: 'core', repo: 'core', title: 'ZenFS' },
	{ name: 'dom', repo: 'dom', title: 'ZenFS DOM' },
	{ name: 'archives', repo: 'archives', title: 'ZenFS Archives' },
	{ name: 'cloud', repo: 'cloud', title: 'ZenFS Cloud' },
	{ name: 'emscripten', repo: 'emscripten', title: 'ZenFS Emscripten' },
	{ name: 'linux', repo: 'linux', title: 'ZenFS Linux' },
];

export const root = resolve(import.meta.dirname, '..');

export const sourcesDir = join(root, '.sources');

export interface Staged {
	/** Human-readable version, e.g. `v2.7.1` or `v2.7.1 (local)`. */
	version: string;
	/** The git ref the source came from, used to build links to GitHub. */
	ref: string;
	/** The repository the source came from. */
	repo: string;
}

/** Where the versions each reference was built from are recorded. */
export const versionsPath = join(sourcesDir, 'versions.json');

/**
 * Read what was staged. Returns an empty object when sources have not been fetched yet.
 */
export function versions(): Record<string, Staged> {
	if (!existsSync(versionsPath)) return {};
	return JSON.parse(readFileSync(versionsPath, 'utf-8')) as Record<string, Staged>;
}

function git(args: string[], cwd: string = root): string {
	return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/**
 * The most recent release tag for a repository.
 *
 * Only `v*` tags are considered: `archives` still carries legacy `x-zip-v*` tags which sort above
 * the real ones and would otherwise be picked.
 */
function latestTag(repo: string): string {
	const url = `https://github.com/zen-fs/${repo}`;
	const output = git(['ls-remote', '--tags', '--refs', '--sort=-v:refname', url, 'v*']);
	const tag = output.split('\n')[0]?.split('refs/tags/')[1];
	if (!tag) throw new Error(`No release tags found for zen-fs/${repo}`);
	return tag;
}

function install(dir: string): void {
	if (existsSync(join(dir, 'node_modules'))) return;
	// Dependencies are only needed so TypeDoc can resolve cross-package imports (e.g. @zenfs/dom
	// importing @zenfs/core), so scripts are skipped and dev dependencies are irrelevant.
	const useCi = existsSync(join(dir, 'package-lock.json'));
	execFileSync('npm', [useCi ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund'], {
		cwd: dir,
		stdio: 'inherit',
	});
}

/**
 * Rewrites a staged package's `tsconfig.json` without its `typedocOptions`.
 *
 * Every package carries `typedocOptions` for its own standalone TypeDoc build, and TypeDoc gives
 * those precedence over the options this site passes— which would send the generated markdown to
 * `<package>/docs` instead of into the site, and pull `core`'s `documentation/*.md` back in as
 * project documents. They are also inherited through `extends`, and an empty `typedocOptions`
 * merges to nothing rather than clearing them, so the field has to actually be gone.
 */
function writeTsconfig(from: string, to: string): void {
	const config = JSON.parse(readFileSync(join(from, 'tsconfig.json'), 'utf-8')) as Record<string, unknown>;
	delete config['typedocOptions'];
	writeFileSync(join(to, 'tsconfig.json'), JSON.stringify(config, null, '\t') + '\n');
}

function remove(path: string): void {
	// `existsSync` follows symlinks, so a stale broken link needs `lstat` to be noticed.
	const stats = lstatSync(path, { throwIfNoEntry: false });
	if (stats?.isSymbolicLink()) unlinkSync(path);
	else if (stats) rmSync(path, { recursive: true, force: true });
}

/**
 * Stages a sibling checkout without writing anything into it: `src` and `node_modules` are
 * symlinked at the same relative paths the package's own `tsconfig.json` expects, and the tsconfig
 * itself is a copy this repo owns.
 */
function link(pkg: Package): Staged {
	const target = resolve(root, '..', pkg.name);
	if (!existsSync(target)) throw new Error(`ZENFS_LOCAL_SOURCES is set but ${target} does not exist`);

	const path = join(sourcesDir, pkg.name);
	remove(path);
	mkdirSync(path);
	symlinkSync(join(target, 'src'), join(path, 'src'), 'dir');
	if (existsSync(join(target, 'node_modules'))) {
		symlinkSync(join(target, 'node_modules'), join(path, 'node_modules'), 'dir');
	} else {
		console.warn(`${pkg.name}: no node_modules in ${target}, imports may not resolve`);
	}
	writeTsconfig(target, path);

	const { version } = JSON.parse(readFileSync(join(target, 'package.json'), 'utf-8')) as { version: string };
	console.log(`${pkg.name}: linked ${target} (v${version})`);
	// A working tree may be ahead of any tag, so source links point at the default branch.
	return { version: `v${version} (local)`, ref: 'main', repo: pkg.repo };
}

function clone(pkg: Package): Staged {
	const tag = latestTag(pkg.repo);
	const path = join(sourcesDir, pkg.name);

	if (existsSync(join(path, '.git')) && tryDescribe(path) === tag) {
		console.log(`${pkg.name}: already at ${tag}`);
	} else {
		remove(path);
		console.log(`${pkg.name}: cloning ${tag}`);
		git(['clone', '--quiet', '--depth', '1', '--branch', tag, `https://github.com/zen-fs/${pkg.repo}`, path]);
	}

	install(path);
	// The clone is disposable, so its tsconfig is stripped in place. Stripping is idempotent, so a
	// cached clone from an earlier run is handled too.
	writeTsconfig(path, path);
	return { version: tag, ref: tag, repo: pkg.repo };
}

function tryDescribe(path: string): string | undefined {
	try {
		return git(['describe', '--tags', '--exact-match'], path);
	} catch {
		return undefined;
	}
}

if (import.meta.main) {
	const local = process.env.ZENFS_LOCAL_SOURCES === '1';
	mkdirSync(sourcesDir, { recursive: true });

	const resolved: Record<string, Staged> = {};
	for (const pkg of packages) {
		resolved[pkg.name] = local ? link(pkg) : clone(pkg);
	}

	writeFileSync(versionsPath, JSON.stringify(resolved, null, '\t') + '\n');
	console.log(`Wrote ${versionsPath}`);
}
