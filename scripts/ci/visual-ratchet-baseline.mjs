/**
 * Resolve a referencia EXATA do comparador visual. Uma execucao periodica/manual
 * compara com uma execucao anterior do mesmo commit; nunca escolhe outra revisao.
 * O gate final do workflow continua exigindo Playwright 100% verde.
 */
export function resolveVisualBaselineSha(eventName, event, currentSha) {
  let sha;
  if (eventName === 'pull_request') sha = event?.pull_request?.base?.sha;
  else if (eventName === 'push') sha = event?.before;
  else if (eventName === 'schedule' || eventName === 'workflow_dispatch') sha = currentSha;
  else throw new Error(`Unsupported event for visual ratchet: ${eventName}`);

  if (!/^[0-9a-f]{40}$/i.test(String(sha ?? '')) || /^0+$/.test(sha)) {
    throw new Error('Unable to resolve exact baseline SHA; failing closed.');
  }
  return sha;
}

export function selectVisualBaselineRun(runs, baselineSha, currentRunId) {
  return (Array.isArray(runs) ? runs : [])
    .filter((run) =>
      run.name === 'Visual full' &&
      run.head_sha === baselineSha &&
      run.status === 'completed' &&
      String(run.id) !== String(currentRunId),
    )
    .sort((a, b) => b.id - a.id)[0];
}
