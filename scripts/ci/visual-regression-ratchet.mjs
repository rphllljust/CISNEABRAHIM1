import { readFile } from 'node:fs/promises';
import { parseVisualFailures } from './visual-regression-parser.mjs';

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

const currentFailures = parseVisualFailures(await readFile(currentLogPath, 'utf8'));
const [owner, repo] = repository.split('/');
// The full suite runs in its OWN workflow. The CI 'Build / artifacts' job
// contains no Playwright results, so it is not a valid visual baseline.
const runs = await githubJson(
  `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(baselineSha)}&status=completed&per_page=100`,
);
const baselineRun = runs.workflow_runs
  ?.filter((run) => run.name === 'Visual full' && run.head_sha === baselineSha && run.status === 'completed')
  .sort((a, b) => b.id - a.id)[0];

if (!baselineRun) {
  throw new Error(
    `No completed Visual full run found for exact baseline SHA ${baselineSha}; failing closed.`,
  );
}

const jobs = await githubJson(
  `/repos/${owner}/${repo}/actions/runs/${baselineRun.id}/jobs?filter=latest&per_page=100`,
);
const visualJob = jobs.jobs?.find((job) => job.name === 'Visual full');

if (!visualJob) {
  throw new Error(
    `Baseline Visual full run ${baselineRun.id} has no Visual full job; failing closed.`,
  );
}

const baselineLog = await (
  await github(`/repos/${owner}/${repo}/actions/jobs/${visualJob.id}/logs`)
).text();
const baselineFailures = parseVisualFailures(baselineLog);
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
