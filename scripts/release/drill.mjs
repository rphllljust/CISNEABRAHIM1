import { loadRepoEnvFiles } from '../lib/env.mjs';
import { runPackageScript } from '../lib/run-package-script.mjs';

loadRepoEnvFiles(['.env.release', '.env']);

process.exit(runPackageScript('release:drill'));
