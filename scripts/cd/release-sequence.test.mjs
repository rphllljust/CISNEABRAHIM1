import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const workflow = (name) => readFileSync(
  new URL(`../../.github/workflows/${name}`, import.meta.url),
  'utf8',
);

describe('CISNE production release sequence — exact SHA, fail-closed', () => {
  it('starts the release on successful CI completion only, not early HML completion', () => {
    const release = workflow('coolify-release.yml');
    assert.match(release, /workflows: \[CI\]/);
    assert.doesNotMatch(release, /workflows: \[CI, HML isolated end-to-end\]/);
    assert.match(release, /github\.event\.workflow_run\.conclusion == 'success'/);
    assert.match(release, /github\.event\.workflow_run\.head_sha == github\.sha/);
    assert.match(release, /github\.ref == 'refs\/heads\/main'/);
  });

  it('runs HML on PRs that modify the release authority or its tests', () => {
    const hml = workflow('hml-isolated-e2e.yml');
    assert.match(hml, /'\.github\/workflows\/coolify-release\.yml'/);
    assert.match(hml, /'scripts\/cd\/\*\*'/);
    assert.match(hml, /push:/);
    assert.match(hml, /- main/);
  });

  it('waits a bounded time for successful HML on the same SHA and refuses failure', () => {
    const release = workflow('coolify-release.yml');
    assert.match(release, /hml-isolated-e2e\.yml\/runs\?branch=main&head_sha=\$EXPECTED_SHA/);
    assert.match(release, /entry\.head_sha===sha && entry\.head_branch==="main"/);
    assert.match(release, /for attempt in \$\(seq 1 90\)/);
    assert.match(release, /FAILED:\*\) echo "::error::publication refused/);
    assert.match(release, /HML did not succeed within 45min/);
    assert.match(release, /hml_job" != "success"/);
    assert.match(release, /CURRENT_MAIN_SHA.*commits\/main/);
    assert.match(release, /CURRENT_MAIN_SHA" != "\$EXPECTED_SHA"/);
    assert.match(release, /select-authorizing-run\.mjs/);
    assert.match(release, /ready" != "success"/);
  });

  it('uses automated exact-SHA technical release checks without a manual business gate', () => {
    const release = workflow('coolify-release.yml');
    assert.doesNotMatch(release, /Require explicit business release approval/);
    assert.doesNotMatch(release, /CISNE_BUSINESS_APPROVED_SHA/);
    assert.match(release, /github\.event\.workflow_run\.conclusion == 'success'/);
    assert.match(release, /hml-isolated-e2e\.yml\/runs\?branch=main&head_sha=\$EXPECTED_SHA/);
    assert.match(release, /CURRENT_MAIN_SHA" != "\$EXPECTED_SHA"/);
    assert.match(release, /ready" != "success"/);
    assert.match(release, /PROVENANCE_EXPECTED_SHA/);
    assert.match(release, /coolify-postdeploy-smoke\.mjs/);
  });

  it('promotes release through GHCR, Coolify, authenticated smoke and Chromium', () => {
    const release = workflow('coolify-release.yml');
    for (const step of [
      'Publish API image',
      'Publish Web image',
      'Publish Worker image',
      'Deploy authorized digests to Coolify',
      'Verify production runtime and authenticated smoke',
      'Browser gate against production',
    ]) {
      assert.ok(release.includes(step), `missing protected release gate: ${step}`);
    }
  });

  it('runs TLS only after successful release and business evidence only after successful TLS', () => {
    const tls = workflow('production-tls-hardening.yml');
    const business = workflow('production-business-evidence.yml');
    assert.match(tls, /workflows: \[Coolify Release Images\]/);
    assert.match(tls, /github\.event\.workflow_run\.conclusion == 'success'/);
    assert.match(business, /workflows: \[Production TLS hardening\]/);
    assert.doesNotMatch(business, /workflows: \[Coolify Release Images\]/);
    assert.match(business, /github\.event\.workflow_run\.conclusion == 'success'/);
    assert.match(business, /github\.event\.workflow_run\.head_sha == github\.sha/);
    assert.match(business, /production-business-attestation\.mjs/);
  });
});
