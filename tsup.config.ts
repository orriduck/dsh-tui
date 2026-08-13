import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    startup: 'src/startup.ts',
    'session-commands': 'src/session-commands.ts',
    bin: 'src/bin.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: [
    /^@deepseek-ai\//,
    'react',
    'react/jsx-runtime',
    'ink',
    'ink-text-input',
  ],
  banner: { js: '#!/usr/bin/env node' },
})
