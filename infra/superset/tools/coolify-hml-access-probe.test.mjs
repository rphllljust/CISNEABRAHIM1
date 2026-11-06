import test from 'node:test';
import assert from 'node:assert/strict';
import { probe } from './coolify-hml-access-probe.mjs';

const respond = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
test('Missing secrets causes zero requests and no write', async () => {
  const r = await probe({ fetchImpl: () => { throw Error('must not fetch'); } });
  assert.equal(r.apiAccess, 'MISSING_OR_INVALID_CONFIGURATION');
  assert.equal(r.writesAttempted, false);
});
test('Deploy-only token returns precise 403 without printing response or token', async () => {
  const called = [];
  const r = await probe({ baseUrl: 'https://coolify.internal/api/v1', token: 'secret-not-for-logs', fetchImpl: async (url, init) => {
    called.push([url, init.method]);
    return respond({ message: 'private detail', password: 'private' }, 403);
  }});
  assert.deepEqual(called, [['https://coolify.internal/api/v1/projects', 'GET']]);
  assert.equal(r.apiAccess, 'PROJECT_READ_DENIED_403');
  assert.equal(r.creationPermission, 'UNVERIFIED_NO_WRITE_ATTEMPT');
  assert.ok(!JSON.stringify(r).includes('secret-not-for-logs'));
  assert.ok(!JSON.stringify(r).includes('private detail'));
});
test('Finds only existing HML environments and prints hashes, never identifiers', async () => {
  const paths = [];
  const r = await probe({baseUrl:'https://control.example.net/api/v1', token:'mysecret', fetchImpl:async(url,init) => {
    assert.equal(init.method,'GET');
    paths.push(new URL(url).pathname);
    if(url.endsWith('/projects')) return respond([{name:'CISNE',uuid:'project-123'}]);
    return respond([{name:'Homologação',uuid:'env-secret-id'}, {name:'staging',uuid:'stage'}, {name:'production',uuid:'prod'}]);
  }});
  assert.equal(r.projectCount, 1);
  assert.equal(r.hmlCandidateCount, 1);
  assert.equal(r.stagingAliasCount, 1);
  assert.equal(r.environmentCount, 3);
  assert.equal(r.apiAccess,'PROJECT_READ_ALLOWED');
  assert.equal(r.writesAttempted,false);
  assert.equal(r.resourceCreated,false);
  assert.deepEqual(paths,['/api/v1/projects','/api/v1/projects/project-123/environments', '/api/v1/servers', '/api/v1/applications', '/api/v1/services']);
  for(const secret of ['project-123','env-secret-id','mysecret','control.example.net']) assert.ok(!JSON.stringify(r).includes(secret));
});
test('Rejects invalid/malicious base URLs without using a bearer token', async () => {
  for(const baseUrl of ['https://username:password@example.com/api/v1','https://host.com/','https://host.com/api/v1?x=1','file:///api/v1']) {
    const r=await probe({baseUrl,token:'secret',fetchImpl:()=>{throw Error('must not fetch')}});
    assert.equal(r.apiAccess,'MISSING_OR_INVALID_CONFIGURATION');
  }
});
