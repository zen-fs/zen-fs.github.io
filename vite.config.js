import { globSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig({
	base: './',
	root: './src',
	build: {
		outDir: '../build',
		emptyOutDir: true,
		target: 'esnext',
		rollupOptions: {
			input: globSync('src/**/*.html'),
		},
	},
});
