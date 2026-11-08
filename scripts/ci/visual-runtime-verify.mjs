import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { platform, release } from 'node:os';
const wanted = '1.62.1';
const version = JSON.parse(readFileSync('apps/web/node_modules/@playwright/test/package.json', 'utf8')).version;
const lock = readFileSync('pnpm-lock.yaml', 'utf8');
assert.equal(version, wanted, 'Playwright must be 1.62.1');
assert.ok(lock.includes("'@playwright/test@1.62.1':"));
assert.equal(platform(), 'linux');
assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, '/ms-playwright');
assert.ok(existsSync('/ms-playwright'));
const fallbackFont = execFileSync('fc-match', ['-f', '%{family}|%{file}', 'sans-serif'], { encoding: 'utf8' }).trim();
assert.ok(fallbackFont.includes('/') && !fallbackFont.endsWith('|'), 'System font resolution must work');
const cli = execFileSync('pnpm', ['--filter', '@cisne/web', 'exec', 'playwright', '--version'], { encoding: 'utf8' }).trim();
assert.ok(cli.includes(wanted), 'CLI version must match browser container');
const fonts = ['inter', 'instrument-sans', 'jetbrains-mono', 'ibm-plex-mono'];
for (const font of fonts) assert.ok(existsSync('apps/web/node_modules/@fontsource/' + font + '/files'), 'Missing font: ' + font);
for (const path of ['apps/web/playwright.config.ts', 'apps/web/playwright.visual-critical.config.ts']) {
 const config = readFileSync(path, 'utf8');
 assert.ok(config.includes('deviceScaleFactor: 1,'));
 assert.ok(config.includes('headless: true,'));
 assert.ok(config.includes("locale: 'pt-BR'"));
}
const proof = { image: 'mcr.microsoft.com/playwright:v1.62.1-noble', version, cli, kernel: release(), fallbackFont, fonts, deviceScaleFactor: 1, locale: 'pt-BR', timezone: 'America/Porto_Velho' };
mkdirSync('artifacts/ci', { recursive: true });
writeFileSync('artifacts/ci/visual-runtime.json', JSON.stringify(proof, null, 2) + '\n');
console.log('Visual runtime pinned: ' + JSON.stringify(proof));
