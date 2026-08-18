import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: './src/renderer/assets/poppin-app-icon',
    protocols: [{ name: 'Poppin Browser', schemes: ['http', 'https'] }],
    // MCP stdio entry is spawned by ACP agents outside Electron; keep it as a
    // real file under resources rather than inside the asar.
    extraResource: ['./scripts/poppin-mcp-server.mjs'],
    // Fuses mutate Electron's executable before Packager reaches its signing
    // phase. Sign the complete bundle afterwards so transferable development
    // builds do not retain Electron's now-stale embedded signature.
    osxSign: {
      identity: '-',
      identityValidation: false,
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      optionsForFile: () => ({ timestamp: 'none', hardenedRuntime: false }),
    },
  },
  makers: [
    new MakerZIP({}, ['darwin']),
    new MakerDMG({
      format: 'ULFO',
      icon: './src/renderer/assets/poppin-app-icon.icns',
    }),
  ],
  plugins: [
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/index.html',
            js: './src/renderer/index.tsx',
            name: 'main_window',
            preload: {
              js: './src/preload/index.ts',
            },
          },
          {
            html: './src/renderer/settings-overlay.html',
            js: './src/renderer/settings-overlay.tsx',
            name: 'settings_overlay',
            preload: {
              js: './src/preload/settings-overlay.ts',
            },
          },
          {
            html: './src/renderer/downloads-overlay.html',
            js: './src/renderer/downloads-overlay.tsx',
            name: 'downloads_overlay',
            preload: {
              js: './src/preload/downloads-overlay.ts',
            },
          },
        ],
      },
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
