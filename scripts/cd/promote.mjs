import { runPackageScript } from '../lib/run-package-script.mjs';

const target = process.argv.includes('--production') ? 'production' : 'hml';

process.exit(
  runPackageScript('cd:promote', target === 'production' ? ['--production'] : [], {
    env: { CD_TARGET_ENV: target },
  }),
);
