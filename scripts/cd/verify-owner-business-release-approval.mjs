#!/usr/bin/env node
/**
 * Alternative SHA-bound release authority: an unedited issue comment by the
 * authenticated repository owner. This authorizes the release pipeline, NOT
 * individual functional acceptance criteria. Never accepts CI text as approval.
 *
 * Manual approval syntax (single exact line, in issue #240):
 * CISNE_RELEASE_GO_V1 SHA=<40-char-main-sha> DECISION=APPROVE
 * Revocation syntax:
 * CISNE_RELEASE_GO_V1 SHA=<40-char-main-sha> DECISION=REVOKE
 */
import { pathToFileURL } from 'node:url';
import { authorizeBusinessRelease, BusinessReleaseRefusedError } from './verify-business-release-approval.mjs';

const OWNER_LOGIN = 'rphllljust';
const OWNER_ID = 264246201;
const EXPECTED_REPO = 'rphllljust/CISNEABRAHIM1';
const APPROVAL_ISSUE = 240;
const DECISION = /^CISNE_RELEASE_GO_V1 SHA=([0-9a-f]{40}) DECISION=(APPROVE|REVOKE)$/i;

export function authorizeOwnerRelease(expectedSha, issueComments) {
  const { sourceSha } = authorizeBusinessRelease(expectedSha, expectedSha);
  if (!Array.isArray(issueComments)) {
    throw new BusinessReleaseRefusedError('owner approval comments are unavailable');
  }

  const decisions = [];
  for (const comment of issueComments) {
    if (comment?.user?.id !== OWNER_ID || comment?.user?.login !== OWNER_LOGIN) continue;
    if (!Number.isSafeInteger(comment.id) || comment.id <= 0) continue;
    const lines = typeof comment.body === 'string' ? comment.body.split(/\r?\n/) : [];
    for (const line of lines) {
      const match = DECISION.exec(line);
      if (!match || match[1].toLowerCase() !== sourceSha) continue;
      // Edited approvals or revocations have ambiguous provenance: fail closed.
      if (!comment.created_at || comment.created_at !== comment.updated_at) {
        throw new BusinessReleaseRefusedError('owner release decision was edited');
      }
      decisions.push({ id: comment.id, decision: match[2].toUpperCase() });
    }
  }
  decisions.sort((a, b) => b.id - a.id);
  if (decisions.length === 0) {
    throw new BusinessReleaseRefusedError('no verified owner release decision for exact SHA');
  }
  if (decisions[0].decision !== 'APPROVE') {
    throw new BusinessReleaseRefusedError('owner revoked release for exact SHA');
  }
  return { sourceSha, authorized: true, approver: OWNER_LOGIN, issue: APPROVAL_ISSUE, commentId: decisions[0].id };
}

export async function fetchOwnerReleaseComments(repository, token, fetcher = fetch) {
  if (repository !== EXPECTED_REPO || typeof token !== 'string' || token.length === 0) {
    throw new BusinessReleaseRefusedError('repository context or GitHub credential is invalid');
  }
  const comments = [];
  for (let page = 1; page <= 20; page++) {
    const url = `https://api.github.com/repos/${EXPECTED_REPO}/issues/${APPROVAL_ISSUE}/comments?per_page=100&page=${page}`;
    const response = await fetcher(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new BusinessReleaseRefusedError('cannot validate owner comments, HTTP ' + response.status);
    }
    const pageComments = await response.json();
    if (!Array.isArray(pageComments)) {
      throw new BusinessReleaseRefusedError('invalid GitHub comments response');
    }
    comments.push(...pageComments);
    if (pageComments.length < 100) return comments;
  }
  throw new BusinessReleaseRefusedError('approval pagination limit reached');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const comments = await fetchOwnerReleaseComments(process.env.GITHUB_REPOSITORY, process.env.GH_TOKEN);
    const approval = authorizeOwnerRelease(process.env.EXPECTED_SHA, comments);
    process.stdout.write('[business-release-approval] verified owner comment=' + approval.commentId +
      ' sha=' + approval.sourceSha + '\n');
  } catch (error) {
    process.stderr.write('[business-release-approval] publication refused: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
