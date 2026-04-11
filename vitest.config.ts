import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
	define: {
		__SDK_VERSION__: JSON.stringify(pkg.version),
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.types.ts', 'src/**/index.ts'],
		},
	},
});
