import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: { SOMAE_SERVICE_PAUSED: 'false', SOMAE_DESKTOP_TOKEN: 'test-desktop-only', SOMAE_BRIDGE_TOKEN: 'test-bridge-signing-key' } },
  })],
  test: { include: ['test/**/*.test.ts'] },
});
