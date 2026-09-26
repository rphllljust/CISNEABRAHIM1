import { loadRepoEnvFiles } from '../lib/env.mjs';
import { runPackageScript } from '../lib/run-package-script.mjs';

loadRepoEnvFiles(['.env.hml', '.env']);

process.exit(runPackageScript('hml:deploy'));
