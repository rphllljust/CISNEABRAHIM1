const VISUAL_RISK_PATTERNS = [
  /^apps\/web\/src\//,
  /^apps\/web\/e2e\/visual\//,
  /^apps\/web\/index\.html$/,
  /^apps\/web\/vite\.config\.ts$/,
  /^apps\/web\/tailwind\.config/,
  /^packages\/ui\//,
  /^packages\/design-/,
  /\.css$/,
];

const CD_ONLY_PATTERN = /^scripts\/cd\//;

export function classifyChangeScope(paths, options = {}) {
  const unknown = options.unknown === true;
  const normalized = Array.isArray(paths)
    ? [...new Set(paths.map((path) => String(path).trim()).filter(Boolean))].sort()
    : [];

  if (unknown) {
    return {
      visualRisk: true,
      integrationRequired: true,
      integrationReason: 'DIFF_INDETERMINATE',
      changedFiles: 'unknown',
      changedPaths: ['<unknown>'],
    };
  }

  if (normalized.length === 0) {
    return {
      visualRisk: true,
      integrationRequired: true,
      integrationReason: 'EMPTY_DIFF',
      changedFiles: '0',
      changedPaths: [],
    };
  }

  const visualRisk = normalized.some((path) =>
    VISUAL_RISK_PATTERNS.some((pattern) => pattern.test(path)),
  );
  const cdOnly = normalized.every((path) => CD_ONLY_PATTERN.test(path));

  return {
    visualRisk,
    integrationRequired: !cdOnly,
    integrationReason: cdOnly ? 'CD_ONLY_CHANGE' : 'IMPACT_REQUIRES_INTEGRATION',
    changedFiles: String(normalized.length),
    changedPaths: normalized,
  };
}

function printOutputs(result) {
  process.stdout.write(
    [
      `visual_risk=${result.visualRisk ? 'true' : 'false'}`,
      `integration_required=${result.integrationRequired ? 'true' : 'false'}`,
      `integration_reason=${result.integrationReason}`,
      `changed_files=${result.changedFiles}`,
      `changed_paths=${JSON.stringify(result.changedPaths)}`,
    ].join('\n') + '\n',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const unknown = process.argv.includes('--unknown');
  if (unknown) {
    printOutputs(classifyChangeScope([], { unknown: true }));
  } else {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => {
      printOutputs(classifyChangeScope(input.split(/\r?\n/)));
    });
  }
}
