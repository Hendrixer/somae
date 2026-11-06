import type { ElectrobunConfig } from 'electrobun';

export default {
  app: { name: 'Somae', identifier: 'ai.getsomae.desktop', version: '0.1.0' },
  build: {
    mainProcess: 'bun',
    bun: { entrypoint: 'src/main/index.ts' },
    copy: { 'dist/view': 'views/mainview', 'dist/bridge.js': 'bridge/server.js', 'dist/native': 'native' },
  },
} satisfies ElectrobunConfig;
