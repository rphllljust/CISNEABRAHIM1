import {
  latestExactRun,
  requiredJobsPassed,
  verifiedPlaywrightLog,
  isProtectedAutomationPath,
} from './auto-merge-contract.mjs';

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repository || !token || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
  throw new Error('Missing trusted GitHub Actions repository/token context');
}

const prefix = '/repos/' + repository;
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: 'Bearer ' + token,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'cisne-verified-automerge',
};

async function github(path, { method = 'GET', body } = {}) {
  const response = await fetch('https://api.github.com' + path, {
    method, headers: {
      ...headers,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.text();
  if (!response.ok) {
    throw new Error(method + ' ' + path + ' -> ' + response.status + ': ' + payload.slice(0, 260));
  }
  if (!payload) return null;
  return (response.headers.get('content-type') ?? '').includes('json')
    ? JSON.parse(payload)
    : payload;
}

async function graphql(query, variables) {
  const response = await github('/graphql', {method: 'POST', body: {query, variables}});
  if (response.errors?.length) {
    throw new Error('GraphQL: ' + response.errors.map((error) => error.message).join('; '));
  }
  return response.data;
}

async function getRunJobs(runId) {
  const response = await github(prefix + '/actions/runs/' + runId + '/jobs?per_page=100&filter=latest');
  if (response.total_count > response.jobs.length) {
    throw new Error('Job list truncated for run ' + runId + '; fail closed');
  }
  return response.jobs;
}

async function exactPlaywrightJobPassed(jobs) {
  const matches = jobs.filter((job) => job.name === 'Visual full');
  if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') {
    return false;
  }
  const log = await github(prefix + '/actions/jobs/' + matches[0].id + '/logs');
  return typeof log === 'string' && verifiedPlaywrightLog(log);
}

async function allFiles(prNumber) {
  const files = [];
  for (let page = 1; page <= 5; page++) {
    const current = await github(prefix + '/pulls/' + prNumber + '/files?per_page=100&page=' + page);
    files.push(...current);
    if (current.length < 100) return files;
  }
  throw new Error('PR #' + prNumber + ' exceeds audited change limit');
}

async function allPullRequests() {
  const items = [];
  for (let page = 1; page <= 5; page++) {
    const current = await github(prefix + '/pulls?state=open&base=main&per_page=100&page=' + page);
    items.push(...current);
    if (current.length < 100) return items;
  }
  throw new Error('Open PR list exceeds audit limit; refusing partial promotion');
}

async function authorize(prSummary) {
  const pr = await github(prefix + '/pulls/' + prSummary.number);
  const number = pr.number;
  const sha = pr.head?.sha;
  const headRepo = pr.head?.repo?.full_name;
  if (pr.state !== 'open' || pr.merged || pr.base?.ref !== 'main' || headRepo !== repository) {
    return 'not an open same-repository PR targeting main';
  }
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return 'head SHA invalid';
  if (pr.auto_merge) return 'GitHub Auto-Merge already enabled';
  const excluded = new Set(['hold', 'no-auto-merge', 'do-not-merge', 'manual-review']);
  if (pr.labels?.some((label) => excluded.has(label.name.toLowerCase()))) {
    return 'explicit no-auto-merge label';
  }
  if (pr.requested_reviewers?.length || pr.requested_teams?.length) {
    return 'review was requested and is not yet complete';
  }
  const main = await github(prefix + '/commits/main');
  if (pr.base.sha !== main.sha || pr.mergeable_state === 'behind') {
    // Strict branch protections require a fresh merge base. Do not update a branch
    // with GITHUB_TOKEN: that push can suppress the new PR checks.
    return 'branch is behind main; fresh checks are required after branch update';
  }
  if (pr.mergeable !== true || pr.mergeable_state === 'dirty') return 'merge conflict or mergeability pending';

  const files = await allFiles(number);
  if (files.some((file) => isProtectedAutomationPath(file.filename))) {
    return 'sensitive workflow or release-authority code: separate review required';
  }

  const runsData = await github(prefix + '/actions/runs?head_sha=' + sha + '&per_page=100');
  const runs = runsData.workflow_runs ?? [];
  const ci = latestExactRun(runs, 'CI', sha);
  const standalone = latestExactRun(runs, 'Visual full', sha);
  if (!ci || !standalone) return 'missing CI or standalone Visual full on exact SHA';
  for (const run of [ci, standalone]) {
    if (run.head_branch !== pr.head.ref || run.head_repository?.full_name !== repository) {
      return 'workflow source branch/repository mismatch';
    }
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      return run.name + ' is not successful on exact head SHA (' + run.status + '/' + run.conclusion + ')';
    }
  }

  const [ciJobs, standaloneJobs] = await Promise.all([
    getRunJobs(ci.id), getRunJobs(standalone.id),
  ]);
  if (!requiredJobsPassed(ciJobs)) return 'CI required job missing/skipped/failed (including Visual full)';
  if (!await exactPlaywrightJobPassed(ciJobs)) {
    return 'CI Visual full lacks a proven zero-failure Playwright run';
  }
  if (!await exactPlaywrightJobPassed(standaloneJobs)) {
    return 'standalone Visual full falsely green or lacks a proven Playwright pass';
  }
  const fresh = await github(prefix + '/pulls/' + number);
  const currentMain = await github(prefix + '/commits/main');
  if (fresh.head.sha !== sha || fresh.base.sha !== currentMain.sha || fresh.mergeable !== true) {
    return 'head or main changed during verification';
  }

  // Never execute code from the PR here: this controller is checked out from
  // the protected default branch and only reads untrusted data via the API.
  if (fresh.draft) {
    await graphql(
      'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{id isDraft}}}',
      {id: fresh.node_id},
    );
  }
  const latest = await github(prefix + '/pulls/' + number);
  if (latest.head.sha !== sha || latest.base.sha !== currentMain.sha) {
    return 'head/base changed before enabling auto-merge';
  }
  await graphql(
    'mutation($id:ID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH}){pullRequest{id autoMergeRequest{enabledAt}}}}',
    {id: latest.node_id},
  );
  return 'AUTO_MERGE_ENABLED on head ' + sha + ' (GH branch protections remain authoritative)';
}

async function ensureMainCi() {
  // GITHUB_TOKEN-initiated merges might not emit push workflows. workflow_dispatch
  // is explicitly permitted to start CI, and the existing CI workflow_run release
  // then publishes to Coolify after HML + provenance verification.
  const main = await github(prefix + '/commits/main');
  const response = await github(prefix + '/actions/runs?head_sha=' + main.sha + '&per_page=100');
  const exists = (response.workflow_runs ?? []).some((run) =>
    run.name === 'CI' && run.head_sha === main.sha && run.head_branch === 'main' &&
    (run.event === 'push' || run.event === 'workflow_dispatch'));
  if (!exists) {
    await github(prefix + '/actions/workflows/ci.yml/dispatches', {
      method: 'POST',
      body: {ref: 'main'},
    });
    console.log('[auto-merge] Dispatched main CI for SHA ' + main.sha);
  }
}

async function main() {
  const pullRequests = await allPullRequests();
  let enabled = 0;
  for (const pr of pullRequests) {
    try {
      const result = await authorize(pr);
      console.log('[auto-merge] #' + pr.number + ': ' + result);
      if (result.startsWith('AUTO_MERGE_ENABLED')) enabled++;
    } catch (error) {
      console.error('[auto-merge] #' + pr.number + ': ' + String(error));
    }
  }
  // A failure to schedule main CI is a genuine delivery failure.
  await ensureMainCi();
  console.log('[auto-merge] Scan completed: ' + pullRequests.length + ' open PRs, enabled=' + enabled);
}

await main();
