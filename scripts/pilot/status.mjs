import { loadRepoEnvFiles } from '../lib/env.mjs';
import { runPackageScript } from '../lib/run-package-script.mjs';

loadRepoEnvFiles(['.env.pilot', '.env']);

process.exit(runPackageScript('pilot:status'));
