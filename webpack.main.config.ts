import type { Configuration } from 'webpack';
import path from 'node:path';

import { rules } from './webpack.rules';

export const mainConfig: Configuration = {
  entry: './src/main/index.ts',
  module: { rules },
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
    // The package's CommonJS entry contains a runtime-computed require that
    // webpack cannot safely analyze. Its ESM build is equivalent and static.
    alias: { docx: path.resolve(__dirname, 'node_modules/docx/dist/index.mjs') },
  },
};
