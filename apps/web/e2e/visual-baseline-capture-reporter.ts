import fs from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const CHUNK_SIZE = 12000;

class VisualBaselineCaptureReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'passed' || result.status === 'skipped') {
      return;
    }

    const projectName = test.parent.project()?.name ?? 'unknown';

    for (const attachment of result.attachments) {
      if (attachment.contentType !== 'image/png' || !attachment.path) {
        continue;
      }

      const fileName = path.basename(test.location.file);
      const expectedPath = path.join(
        path.dirname(test.location.file),
        `${fileName}-snapshots`,
        `${attachment.name}-${projectName}.png`,
      );

      const relativeExpectedPath = path
        .relative(process.cwd(), expectedPath)
        .replaceAll(path.sep, '/');

      const base64 = fs.readFileSync(attachment.path).toString('base64');
      const chunks = Math.ceil(base64.length / CHUNK_SIZE);

      console.log(
        `VISUAL_ACTUAL_BEGIN|${relativeExpectedPath}|${base64.length}|${chunks}`,
      );

      for (let index = 0; index < chunks; index += 1) {
        const start = index * CHUNK_SIZE;
        const chunk = base64.slice(start, start + CHUNK_SIZE);
        console.log(
          `VISUAL_ACTUAL_CHUNK|${relativeExpectedPath}|${index}|${chunk}`,
        );
      }

      console.log(`VISUAL_ACTUAL_END|${relativeExpectedPath}`);
    }
  }
}

export default VisualBaselineCaptureReporter;
