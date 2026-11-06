import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectSupersetConfiguration } from './check-config-readiness.mjs';

const configured = {
  SUPERSET_INTERNAL_URL: 'http://superset-web:8088/',
  SUPERSET_PUBLIC_URL: 'https://bi-hml.example.org/',
  SUPERSET_SERVICE_USERNAME: 'service',
  SUPERSET_SERVICE_PASSWORD: 'PRIVATE_AND_UNPRINTABLE_VALUE',
  SUPERSET_DASHBOARD_SERVICE_ORDERS_ID: '162c6754-c80e-48b4-ae0c-54d201cebe9f',
  SUPERSET_EMBED_ENABLED: 'false',
};

test('missing values never count as operational acceptance', () => {
  const result = inspectSupersetConfiguration({});
  assert.equal(result.configValidated, false);
  assert.equal(result.operationallyReady, false);
  assert.ok(result.missing.includes('SUPERSET_SERVICE_PASSWORD'));
  assert.ok(result.problems.includes('no_real_dashboard_uuid_configured'));
});

test('valid syntax is not proof of Superset or RLS runtime', () => {
  const result = inspectSupersetConfiguration(configured);
  assert.equal(result.configValidated, true);
  assert.equal(result.operationallyReady, false);
  assert.equal(result.liveSupersetHealthVerified, false);
  assert.equal(result.guestTokenRlsCrossUnitVerified, false);
  assert.equal(result.browserArtifactFlagVerified, false);
  assert.deepEqual(result.configuredDashboards, ['service-orders']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_AND_UNPRINTABLE_VALUE/);
});

test('rejects placeholder domains and bad UUIDs without exposing secrets', () => {
  const result = inspectSupersetConfiguration({
    ...configured,
    SUPERSET_PUBLIC_URL: 'https://superset-hml.example.invalid/',
    SUPERSET_DASHBOARD_SERVICE_ORDERS_ID: 'fake-dashboard-id',
  });
  assert.equal(result.configValidated, false);
  assert.ok(result.problems.some((p) => p.includes('SUPERSET_PUBLIC_URL')));
  assert.ok(result.problems.some((p) => p.includes('invalid_uuid')));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_AND_UNPRINTABLE_VALUE/);
});

test('rejects insecure URL, embedded credentials and unsupported protocol', () => {
  for (const publicUrl of ['http://bi-hml.example.org', 'https://u:p@bi-hml.example.org', 'ftp://bi-hml.example.org']) {
    assert.equal(inspectSupersetConfiguration({ ...configured, SUPERSET_PUBLIC_URL: publicUrl }).configValidated, false);
  }
});

test('backend enable alone never marks HML or production as ready', () => {
  const result = inspectSupersetConfiguration({ ...configured, SUPERSET_EMBED_ENABLED: 'true' });
  assert.equal(result.backendFeatureEnabled, true);
  assert.equal(result.operationallyReady, false);
});
