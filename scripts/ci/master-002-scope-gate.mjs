import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * MASTER 002: structural completeness guard for the unified ERP program.
 * Checks only that every module has its canonical source owners. This is
 * deliberately NOT an acceptance test and cannot promote a release.
 * Functional completion requires business journeys and verified evidence.
 */
export const MASTER_002_MODULES = Object.freeze([
  { id: '01', name: 'Central Empresarial', owners: ['apps/web/src/workspaces', 'apps/api/src/work-inbox'] },
  { id: '02', name: 'Clientes 360', owners: ['apps/web/src/clients', 'apps/api/src/clients'] },
  { id: '03', name: 'Solicitacoes', owners: ['apps/web/src/requests', 'apps/api/src/requests'] },
  { id: '04', name: 'Propostas e Contratos', owners: ['apps/web/src/proposals', 'apps/web/src/contracts', 'apps/api/src/commercial'] },
  { id: '05', name: 'Ordens de Servico', owners: ['apps/web/src/service-orders', 'apps/api/src/service-orders'] },
  { id: '06', name: 'Pessoas', owners: ['apps/web/src/people', 'apps/api/src/people'] },
  { id: '07', name: 'Ativos e Frota', owners: ['apps/web/src/assets', 'apps/web/src/fleet', 'apps/api/src/resources'] },
  { id: '08', name: 'Locacoes e Transporte', owners: ['apps/web/src/rentals', 'apps/web/src/transport', 'apps/api/src/service-orders'] },
  { id: '09', name: 'Catalogo', owners: ['apps/web/src/catalog', 'apps/api/src/catalog'] },
  { id: '10', name: 'GED', owners: ['apps/web/src/documents', 'apps/api/src/documents'] },
  { id: '11', name: 'Compras e Estoque', owners: ['apps/web/src/procurement', 'apps/web/src/inventory', 'apps/api/src/procurement', 'apps/api/src/inventory'] },
  { id: '12', name: 'Financeiro', owners: ['apps/web/src/finance', 'apps/api/src/finance'] },
  { id: '13', name: 'Fiscal', owners: ['apps/web/src/fiscal', 'apps/api/src/fiscal'] },
  { id: '14', name: 'Contabilidade', owners: ['apps/web/src/accounting', 'apps/api/src/accounting'] },
  { id: '15', name: 'Folha', owners: ['apps/web/src/payroll', 'apps/api/src/payroll'] },
  { id: '16', name: 'Relatorios e BI', owners: ['apps/web/src/reports', 'apps/web/src/analytics', 'apps/api/src/reports', 'apps/api/src/analytics'] },
]);

export const MASTER_002_JOURNEYS = Object.freeze([
  'Service-to-Cash',
  'Procure-to-Pay',
  'Resource-to-Service',
  'Document-to-Evidence',
  'Record-to-Report',
]);

const REQUIRED_IDS = Array.from({ length: 16 }, (_, index) => String(index + 1).padStart(2, '0'));

export function verifyMaster002Structure(projectRoot) {
  assert.deepEqual(MASTER_002_MODULES.map(({ id }) => id), REQUIRED_IDS,
    'MASTER 002 must enumerate all 16 modules in canonical order');
  assert.equal(new Set(MASTER_002_JOURNEYS).size, 5,
    'MASTER 002 must enumerate all five distinct enterprise journeys');
  const missing = MASTER_002_MODULES.flatMap(({ id, name, owners }) =>
    owners.filter((owner) => !existsSync(resolve(projectRoot, owner)))
      .map((owner) => ({ id, module: name, owner })),
  );
  assert.deepEqual(missing, [], 'Canonical frontend/backend owners are missing');
  return {
    modulesWithSourceOwners: MASTER_002_MODULES.length,
    journeysEnumerated: MASTER_002_JOURNEYS.length,
    functionalAcceptance: 'NOT_EVALUATED',
    note: 'Structural presence is not functional completeness or production approval.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  process.stdout.write(JSON.stringify(verifyMaster002Structure(root)) + '\n');
}
