import { loadRepoEnvFiles } from '../lib/env.mjs';
import { runPackageScript } from '../lib/run-package-script.mjs';

loadRepoEnvFiles(['.env.prod', '.env']);

process.exit(runPackageScript('prod:validate'));
