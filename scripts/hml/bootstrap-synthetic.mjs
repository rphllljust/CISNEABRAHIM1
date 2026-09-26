import { loadRepoEnvFiles } from '../lib/env.mjs';
import { spawnSync } from 'node:child_process';

loadRepoEnvFiles(['.env.hml', '.env']);

if (process.env['CISNE_ENV'] !== 'hml') {
  console.error('CISNE_ENV must be hml');
  process.exit(1);
}

if (process.env['HML_SYNTHETIC_SEED_CONFIRM'] !== 'I_UNDERSTAND') {
  console.error('HML_SYNTHETIC_SEED_CONFIRM=I_UNDERSTAND is required for synthetic HML bootstrap');
  process.exit(1);
}

const steps = [
  ['pnpm', ['--filter', '@cisne/database', 'bootstrap:production']],
  ['pnpm', ['--filter', '@cisne/api', 'hml:grant-pilot-operator']],
  ['pnpm', ['db:seed:portfolio']],
];

for (const [command, args] of steps) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('HML synthetic bootstrap completed (fictional data only).');
