import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { authorizeOwnerRelease, fetchOwnerReleaseComments } from './verify-owner-business-release-approval.mjs';

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const owner = { id: 264246201, login: 'rphllljust' };
const decision = (id, action='APPROVE', hash=sha, extra={}) => ({
  id, user: owner, body: `CISNE_RELEASE_GO_V1 SHA=${hash} DECISION=${action}`,
  created_at: '2026-11-05T17:00:00Z', updated_at: '2026-11-05T17:00:00Z',
  ...extra,
});

test('owner authorization requires a matching unedited owner-authored SHA approval', () => {
  assert.deepEqual(authorizeOwnerRelease(sha, [decision(10)]), {
    sourceSha: sha, authorized: true, approver: 'rphllljust', issue: 240, commentId: 10,
  });
  assert.throws(() => authorizeOwnerRelease(sha, []), /no verified owner/);
  assert.throws(() => authorizeOwnerRelease(sha, [decision(11, 'APPROVE', other)]), /no verified owner/);
  assert.throws(() => authorizeOwnerRelease(sha, [decision(12, 'APPROVE', sha, {user: {id: 3, login: 'rphllljust'}})]), /no verified owner/);
  assert.throws(() => authorizeOwnerRelease(sha, [decision(12, 'APPROVE', sha, {user: {id: 264246201, login: 'attacker'}})]), /no verified owner/);
  assert.throws(() => authorizeOwnerRelease(sha, [decision(12, 'APPROVE', sha, {updated_at:'2026-11-05T17:00:01Z'})]), /edited/);
  assert.throws(() => authorizeOwnerRelease(sha, [decision(12, 'APPROVE', sha, {body:'CISNE_RELEASE_GO_V1 SHA=' + sha + ' DECISION=APPROVE extra'})]), /no verified owner/);
  assert.throws(() => authorizeOwnerRelease(sha, [decision(12, 'APPROVE', sha, {body:'some text CISNE_RELEASE_GO_V1 SHA=' + sha + ' DECISION=APPROVE'})]), /no verified owner/);
});

test('latest owner decision per SHA wins and REVOKE fails closed', () => {
  assert.throws(() => authorizeOwnerRelease(sha, [decision(10), decision(11, 'REVOKE')]), /revoked/);
  assert.equal(authorizeOwnerRelease(sha, [decision(10, 'REVOKE'), decision(11)]).commentId, 11);
  assert.equal(authorizeOwnerRelease(sha, [decision(10), decision(11, 'REVOKE', other)]).commentId, 10);
  assert.throws(() => authorizeOwnerRelease(sha, [decision(10), decision(11, 'APPROVE', sha, {updated_at:'2026-11-05T17:00:01Z'})]), /edited/);
});

test('fetch fails closed on missing auth, incorrect repository, HTTP failures and invalid JSON shape', async () => {
  await assert.rejects(fetchOwnerReleaseComments('other/repo', 'token', async()=>({ok:true,json:async()=>[]})), /repository/);
  await assert.rejects(fetchOwnerReleaseComments('rphllljust/CISNEABRAHIM1', '', async()=>({ok:true,json:async()=>[]})), /credential/);
  await assert.rejects(fetchOwnerReleaseComments('rphllljust/CISNEABRAHIM1','token',async()=>({ok:false,status:403})), /HTTP 403/);
  await assert.rejects(fetchOwnerReleaseComments('rphllljust/CISNEABRAHIM1','token',async()=>({ok:true,json:async()=>({})})), /invalid GitHub/);
});

test('fetch request is scoped to exact repository and issue with read-only API', async () => {
  const calls = [];
  const comments = await fetchOwnerReleaseComments('rphllljust/CISNEABRAHIM1','token',async (url,opts)=>{
    calls.push({url,opts});
    return {ok:true,json:async()=>[decision(1)]};
  });
  assert.equal(comments.length,1);
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/\/repos\/rphllljust\/CISNEABRAHIM1\/issues\/240\/comments\?per_page=100&page=1$/);
  assert.equal(calls[0].opts.headers.Authorization,'Bearer token');
});

test('official Coolify release does not depend on legacy issue approval', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/coolify-release.yml',import.meta.url),'utf8');
  assert.doesNotMatch(workflow, /name: Require explicit business release approval \(exact SHA\)/);
  assert.doesNotMatch(workflow, /node scripts\/cd\/verify-owner-business-release-approval\.mjs/);
  assert.doesNotMatch(workflow, /CISNE_BUSINESS_APPROVED_SHA:/);
  assert.doesNotMatch(workflow, /issues: read/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /name: Require Release Ready/);
  const ci=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
  assert.ok(ci.includes('scripts/cd/verify-owner-business-release-approval.test.mjs'));
});
