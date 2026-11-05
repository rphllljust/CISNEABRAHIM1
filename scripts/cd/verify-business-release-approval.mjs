#!/usr/bin/env node
/**
 * MASTER 002 — business release authority is independent of the CI gate.
 *
 * An integration into main does NOT authorize GHCR publishing or Coolify deployment.
 * The repo administrator sets the SHA-scoped Actions variable only after external
 * functional acceptance has been evidenced and signed off.
 *
 * Missing, partial, mismatched or stale approvals always refuse publication.
 */
import { pathToFileURL } from 'node:url';

export class BusinessReleaseRefusedError extends Error {}

export function authorizeBusinessRelease(expectedSha, approvedSha) {
  if (typeof expectedSha !== 'string' || !/^[0-9a-f]{40}$/i.test(expectedSha.trim())) {
    throw new BusinessReleaseRefusedError('expected source SHA is invalid');
  }
  const sourceSha = expectedSha.trim().toLowerCase();
  if (typeof approvedSha !== 'string' || !/^[0-9a-f]{40}$/i.test(approvedSha.trim())) {
    throw new BusinessReleaseRefusedError('no valid SHA-bound business approval exists');
  }
  if (approvedSha.trim().toLowerCase() !== sourceSha) {
    throw new BusinessReleaseRefusedError('business approval does not match current source SHA');
  }
  return { sourceSha, authorized: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const approval = authorizeBusinessRelease(
      process.env.EXPECTED_SHA,
      process.env.CISNE_BUSINESS_APPROVED_SHA,
    );
    process.stdout.write('[business-release-approval] authorized sha=' + approval.sourceSha + '\n');
  } catch (error) {
    process.stderr.write('[business-release-approval] publication refused: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
