import { readFile } from 'node:fs/promises';

const [currentLogPath] = process.argv.slice(2);
if (!currentLogPath) {
  throw new Error('Usage: node visual-regression-ratchet.mjs <current-log>');
}

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const eventName = process.env.GITHUB_EVENT_NAME;
const eventPath = process.env.GITHUB_EVENT_PATH;
const visualOutcome = process.env.VISUAL_OUTCOME;

if (!repository || !token || !eventName || !eventPath) {
  throw new Error('GitHub Actions context is incomplete.');
}

if (visualOutcome === 'success') {
  console.log('Visual regression: current commit is fully green.');
  process.exit(0);
}

const stripAnsi = (value) => value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

function parseFailures(raw) {
  const lines = stripAnsi(raw).split(/\r?\n/);
  let summaryIndex = -1;
  let expectedCount = null;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(/\b(\d+) failed\b/);
    if (match) {
      summaryIndex = index;
      expectedCount = Number(match[1]);
      break;
    }
  }

  if (summaryIndex < 0 || expectedCount === null) {
    throw new Error('Visual command failed without a parseable Playwright failure summary; failing closed.');
  }

  const failures = [];
  for (const line of lines.slice(summaryIndex + 1)) {
    const match = line.match(/\s+\[([^\]]+)\]\s+›\s+(.+?)\s*$/);
    if (match) failures.push(`[${match[1]}] › ${match[2].trim()}`);
  }

  const unique = [...new Set(failures)];
  if (unique.length !== expectedCount) {
    throw new Error(`Parsed ${unique.length} unique failures, but Playwright reported ${expectedCount}; failing closed.`);
  }

  return unique;
}

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'cisne-visual-regression-ratchet',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}: ${await response.text()}`);
  }

  return response;
}

async function githubJson(path) {
  return (await github(path)).json();
}

const event = JSON.parse(await readFile(eventPath, 'utf8'));
let baselineSha;

if (eventName === 'pull_request') {
  baselineSha = event.pull_request?.base?.sha;
} else if (eventName === 'push') {
  baselineSha = event.before;
} else {
  throw new Error(`Unsupported event for visual ratchet: ${eventName}`);
}

if (!baselineSha || /^0+$/.test(baselineSha)) {
  throw new Error('Unable to resolve exact baseline SHA; failing closed.');
}

const currentFailures = parseFailures(await readFile(currentLogPath, 'utf8'));
const [owner, repo] = repository.split('/');
const runs = await githubJson(
  `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(baselineSha)}&event=push&status=completed&per_page=100`,
);
const baselineRun = runs.workflow_runs?.find(
  (run) => run.name === 'CI' && run.head_sha === baselineSha,
);

if (!baselineRun) {
  throw new Error(
    `No completed CI push run found for exact baseline SHA ${baselineSha}; failing closed.`,
  );
}

const jobs = await githubJson(
  `/repos/${owner}/${repo}/actions/runs/${baselineRun.id}/jobs?filter=latest&per_page=100`,
);
const buildJob = jobs.jobs?.find((job) => job.name === 'Build / artifacts');

if (!buildJob) {
  throw new Error(
    `Baseline CI run ${baselineRun.id} has no Build / artifacts job; failing closed.`,
  );
}

const baselineLog = await (
  await github(`/repos/${owner}/${repo}/actions/jobs/${buildJob.id}/logs`)
).text();
const baselineFailures = parseFailures(baselineLog);
const baselineSet = new Set(baselineFailures);
const newFailures = currentFailures.filter((failure) => !baselineSet.has(failure));

console.log(
  `Visual regression ratchet: baseline=${baselineFailures.length}, current=${currentFailures.length}, new=${newFailures.length}.`,
);
console.log(
  `Exact baseline SHA: ${baselineSha}; baseline CI run: ${baselineRun.id}.`,
);

if (newFailures.length > 0) {
  console.error('New visual regressions detected:');
  for (const failure of newFailures) console.error(`- ${failure}`);
  process.exit(1);
}

if (currentFailures.length > baselineFailures.length) {
  throw new Error(
    'Current visual failure count exceeds baseline without identifiable new test IDs; failing closed.',
  );
}

console.log(
  'No new visual failing test IDs relative to the exact base commit. Existing baseline debt does not block this change.',
);
