/**
 * Playwright source location (:line:column) is NOT part of a stable test ID.
 * A refactor above the same test changes its line without changing behavior.
 * Only strip locations on a .spec/.test module immediately before the › separator.
 * Keep project, file path and full test title; fail closed on collisions.
 */
export function stableVisualFailureId(id) {
  return id.replace(/(\.(?:spec|test)\.[cm]?[jt]sx?):\d+:\d+(?=\s+›)/g, '$1');
}

/** Parse Playwright's final failure block, excluding flaky/skipped/passed sections. */
export function parseVisualFailures(raw) {
  const lines = raw.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/);
  let summaryIndex = -1;
  let expectedCount = null;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const summaryLine = lines[index].replace(/^\d{4}-\d{2}-\d{2}T[^\s]+Z\s*/, '');
    const match = summaryLine.match(/^\s*(\d+)\s+failed\b/);
    if (match) {
      summaryIndex = index;
      expectedCount = Number(match[1]);
      break;
    }
  }

  if (summaryIndex < 0 || expectedCount === null || expectedCount < 1) {
    throw new Error('Visual command failed without a parseable Playwright failure summary; failing closed.');
  }

  const failures = [];
  for (const line of lines.slice(summaryIndex + 1)) {
    // GitHub job logs prefix lines with timestamps; remove them before testing section boundaries.
    const normalized = line.replace(/^\d{4}-\d{2}-\d{2}T[^\s]+Z\s*/, '');
    if (/^\s*\d+\s+(?:flaky|skipped|passed)\b/.test(normalized)) break;
    const match = line.match(/\s+\[([^\]]+)\]\s+›\s+(.+?)\s*$/);
    if (match) failures.push(stableVisualFailureId(`[${match[1]}] › ${match[2].trim()}`));
  }

  const unique = [...new Set(failures)];
  if (unique.length !== expectedCount) {
    throw new Error(`Parsed ${unique.length} unique failures, but Playwright reported ${expectedCount}; failing closed.`);
  }

  return unique;
}
