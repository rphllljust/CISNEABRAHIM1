import { describe, expect, it } from 'vitest';
import { isNavItemVisible } from '../shell/useNavAccess';
import {
  BUILT_MODULES,
  STUB_MODULES,
  isReleaseModuleEnabled,
  resolveModuleFlag,
} from './feature-flags';
import { FEATURE_FLAG_ENV, GATED_MODULE_IDS, matchGatedWebPath } from './release-1-scope';

describe('web release feature flags', () => {
  it('is fail-closed when Vite flags are absent', () => {
    const env = {};
    for (const moduleId of GATED_MODULE_IDS) {
      expect(isReleaseModuleEnabled(moduleId, env)).toBe(false);
    }
  });

  it('maps out-of-scope routes and leaves Release 1 routes unmatched', () => {
    expect(matchGatedWebPath('/app/finance/receivables')).toBe('finance');
    expect(matchGatedWebPath('/app/fiscal/documents')).toBe('fiscal');
    expect(matchGatedWebPath('/app/accounting/journals')).toBe('accounting');
    expect(matchGatedWebPath('/app/people')).toBe('people');
    expect(matchGatedWebPath('/app/rentals')).toBe('rentals');
    expect(matchGatedWebPath('/app/inventory')).toBe('inventory');
    expect(matchGatedWebPath('/app/payroll/periods/1')).toBe('payroll');
    expect(matchGatedWebPath('/app/procurement/invoices')).toBe('procurement');
    expect(matchGatedWebPath('/app/suppliers')).toBe('suppliers');
    expect(matchGatedWebPath('/app/reports')).toBe('reports');
    expect(matchGatedWebPath('/app/operational-profitability')).toBe('operational-profitability');
    expect(matchGatedWebPath('/app/clients')).toBeNull();
    expect(matchGatedWebPath('/app/billing')).toBeNull();
    expect(matchGatedWebPath('/app/service-orders/1/planning')).toBeNull();
  });

  it('enables a gated route only with exact true', () => {
    expect(isReleaseModuleEnabled('fiscal', { [FEATURE_FLAG_ENV.fiscal]: 'true' })).toBe(true);
    expect(isReleaseModuleEnabled('fiscal', { [FEATURE_FLAG_ENV.fiscal]: 'TRUE' })).toBe(false);
  });

  it('hides gated navigation while the flag is off', () => {
    expect(isNavItemVisible('accounting-journals', { 'accounting-journals': true }, false)).toBe(
      false,
    );
    expect(isNavItemVisible('inventory', { inventory: true }, false)).toBe(false);
    expect(isNavItemVisible('payroll', { payroll: true }, false)).toBe(false);
    expect(isNavItemVisible('procurement', { procurement: true }, false)).toBe(false);
    expect(isNavItemVisible('suppliers', { suppliers: true }, false)).toBe(false);
    expect(isNavItemVisible('billing', { billing: true }, false)).toBe(true);
    expect(isNavItemVisible('clients', { clients: true }, false)).toBe(true);
  });
});

/**
 * POLÍTICA DE SUPERFÍCIE — a flag de build não substitui autorização, e o default por
 * ambiente precisa honrar o produto CONSTRUÍDO. Estes casos são o que impede a regressão
 * silenciosa que motivou a Wave 0: um default de Dockerfile produzindo HML mutilado.
 */
describe('release surface policy', () => {
  it('classifies every gated module as built or stub, never both', () => {
    for (const moduleId of GATED_MODULE_IDS) {
      const built = BUILT_MODULES.has(moduleId);
      const stub = STUB_MODULES.has(moduleId);
      expect(built || stub).toBe(true);
      expect(built && stub).toBe(false);
    }
  });

  it('turns built modules ON by default on a homologation surface', () => {
    const env = { VITE_CISNE_SURFACE: 'hml' };
    for (const moduleId of BUILT_MODULES) {
      const resolved = resolveModuleFlag(moduleId, env);
      expect(resolved.enabled).toBe(true);
      expect(resolved.origin).toBe('surface-default');
    }
  });

  it('keeps stub modules OFF even on a homologation surface', () => {
    const env = { VITE_CISNE_SURFACE: 'hml' };
    for (const moduleId of STUB_MODULES) {
      expect(resolveModuleFlag(moduleId, env)).toEqual({
        enabled: false,
        origin: 'conservative-default',
      });
    }
  });

  it('stays conservative on production, regardless of the built set', () => {
    const env = { VITE_CISNE_SURFACE: 'prod' };
    for (const moduleId of GATED_MODULE_IDS) {
      expect(resolveModuleFlag(moduleId, env).enabled).toBe(false);
    }
  });

  it('stays conservative when the surface is not declared at all', () => {
    // Um bundle esquecido nunca publica módulo não homologado.
    expect(resolveModuleFlag('fiscal', {})).toEqual({
      enabled: false,
      origin: 'conservative-default',
    });
  });

  it('lets an explicit module flag override the surface default in both directions', () => {
    const homolog = { VITE_CISNE_SURFACE: 'hml' };
    expect(resolveModuleFlag('fiscal', { ...homolog, [FEATURE_FLAG_ENV.fiscal]: 'false' })).toEqual({
      enabled: false,
      origin: 'explicit-env',
    });
    expect(
      resolveModuleFlag('rentals', { ...homolog, [FEATURE_FLAG_ENV.rentals]: 'true' }),
    ).toEqual({ enabled: true, origin: 'explicit-env' });
  });

  it('honours only exact lowercase true/false as an explicit flag', () => {
    const env = { VITE_CISNE_SURFACE: 'hml', [FEATURE_FLAG_ENV.fiscal]: 'TRUE' };
    // 'TRUE' não é valor reconhecido => cai no default da superfície, não vira ligado por acaso.
    expect(resolveModuleFlag('fiscal', env)).toEqual({
      enabled: true,
      origin: 'surface-default',
    });
  });
});
