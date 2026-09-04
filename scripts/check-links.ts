#!/usr/bin/env node
/* Checks every internal link in the built site against the pages and assets that were actually emitted */
import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '../dist');

/** Paths deployed from a different repository onto zenfs.dev, so they are absent from `dist`. */
const external = ['/playground/'];

const files = globSync('**/*.html', { cwd: dist });
const pages = new Set(files.map(file => '/' + file.replace(/index\.html$/, '').replace(/\.html$/, '')));
const assets = new Set(globSync('**/*', { cwd: dist }).map(file => '/' + file));

const dead = new Map<string, Set<string>>();

for (const file of files) {
	const html = readFileSync(join(dist, file), 'utf-8');

	for (const [, raw] of html.matchAll(/\shref="([^"]+)"/g)) {
		if (/^(https?:|mailto:|#|data:)/.test(raw)) continue;

		const href = raw.split('#')[0]!.split('?')[0]!;
		if (!href.startsWith('/')) continue;
		if (external.some(prefix => href.startsWith(prefix))) continue;

		const slash = href.endsWith('/') ? href : href + '/';
		if (pages.has(slash) || pages.has(href) || assets.has(href)) continue;

		dead.getOrInsert(href, new Set()).add('/' + file);
	}
}

if (!dead.size) {
	console.log(`No dead internal links across ${files.length} pages.`);
	process.exit(0);
}

for (const [href, from] of Array.from(dead).sort()) {
	const sources = [...from];
	const shown = sources.slice(0, 4).join(', ');
	console.error(`DEAD ${href}\n   from: ${shown}${sources.length > 4 ? ` (+${sources.length - 4} more)` : ''}`);
}

console.error(`\n${dead.size} dead link target(s).`);
process.exit(1);
