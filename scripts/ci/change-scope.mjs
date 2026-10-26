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

const INTEGRATION_NOT_REQUIRED_PATTERNS = [
  /^scripts\/cd\//,
];

export function classifyChangeScope(paths, options = {}) {
  const unknown = options.unknown === true;
  const normalized = Array.isArray(paths)
    ? paths.map((path) => String(path).trim()).filter(Boolean)
    : [];

  if (unknown || normalized.length === 0) {
    return {
      visualRisk: true,
      integrationRequired: true,
      changedFiles: unknown ? 'unknown' : String(normalized.length),
    };
  }

  const visualRisk = normalized.some((path) =>
    VISUAL_RISK_PATTERNS.some((pattern) => pattern.test(path)),
  );

  const integrationRequired = normalized.some(
    (path) =>
      !INTEGRATION_NOT_REQUIRED_PATTERNS.some((pattern) => pattern.test(path)),
  );

  return {
    visualRisk,
    integrationRequired,
    changedFiles: String(normalized.length),
  };
}

function printOutputs(result) {
  process.stdout.write(
    [
      `visual_risk=${result.visualRisk ? 'true' : 'false'}`,
      `integration_required=${result.integrationRequired ? 'true' : 'false'}`,
      `changed_files=${result.changedFiles}`,
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
