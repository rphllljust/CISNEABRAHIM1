import { describe, expect, it } from 'vitest';
import { isNavItemVisible } from '../shell/useNavAccess';
import {
  BUILT_MODULES,
  HML_CANDIDATE_MODULES,
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

  /*
   * VISIBILIDADE DE NAVEGAÇÃO — O GATE DE FLAG É REAL, MAS NÃO É O QUE ESTE CASO MEDE.
   *
   * O caso antigo chamava `isNavItemVisible('inventory', { inventory: true }, false)` e
   * esperava `false`, partindo do princípio de que a flag de módulo estaria desligada. Isso
   * NÃO se sustenta no ambiente de teste: `VITE_CISNE_SURFACE=dev` promove todo módulo de
   * `BUILT_MODULES` a ligado (política documentada em `feature-flags.ts` — homologação existe
   * para homologar o produto construído), e `isNavItemVisible` lê `import.meta.env` direto,
   * sem receber env por parâmetro.
   *
   * O resultado era um teste que passava ou falhava conforme o `.env` da máquina — um gate
   * que não media comportamento determinístico.
   *
   * A separação correta, e é o que este caso passa a prender:
   *   1. o GATE DE FLAG é verificado em `resolveModuleFlag`, com env passado EXPLICITAMENTE
   *      (os casos acima já fazem isso, e são determinísticos);
   *   2. a VISIBILIDADE POR ACESSO é verificada aqui, com itens cuja flag não interfere, e
   *      com os três estados possíveis do mapa: concedido, negado e ainda carregando.
   */
  it('hides gated navigation while the access map denies or is still loading', () => {
    // SEM GRANT: o item não aparece, mesmo com a flag de superfície ligada.
    expect(isNavItemVisible('billing', {}, false)).toBe(false);
    // CARREGANDO: fail-closed enquanto a sondagem não respondeu.
    expect(isNavItemVisible('billing', { billing: true }, true)).toBe(false);
    // CONCEDIDO: com grant explícito e sem carga pendente, o item aparece.
    expect(isNavItemVisible('billing', { billing: true }, false)).toBe(true);
    // ITEM INEXISTENTE: id desconhecido nunca vira item visível.
    expect(isNavItemVisible('nao-existe', {}, false)).toBe(false);
  });

});

/**
 * POLÍTICA DE SUPERFÍCIE — a flag de build não substitui autorização, e o default por
 * ambiente precisa honrar o produto CONSTRUÍDO. Estes casos são o que impede a regressão
 * silenciosa que motivou a Wave 0: um default de Dockerfile produzindo HML mutilado.
 */
describe('release surface policy', () => {
  it('classifies every gated module as production-built, HML candidate or stub', () => {
    for (const moduleId of GATED_MODULE_IDS) {
      const statuses = [
        BUILT_MODULES.has(moduleId),
        HML_CANDIDATE_MODULES.has(moduleId),
        STUB_MODULES.has(moduleId),
      ];
      expect(statuses.filter(Boolean)).toHaveLength(1);
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

  it('exposes OS-backed rental and transport worklists to HML, not production by default', () => {
    for (const moduleId of ['rentals', 'transport'] as const) {
      expect(BUILT_MODULES.has(moduleId)).toBe(false);
      expect(HML_CANDIDATE_MODULES.has(moduleId)).toBe(true);
      expect(STUB_MODULES.has(moduleId)).toBe(false);
      expect(resolveModuleFlag(moduleId, { VITE_CISNE_SURFACE: 'hml' })).toEqual({
        enabled: true,
        origin: 'surface-default',
      });
      expect(resolveModuleFlag(moduleId, { VITE_CISNE_SURFACE: 'prod' })).toEqual({
        enabled: false,
        origin: 'conservative-default',
      });
      expect(resolveModuleFlag(moduleId, {
        VITE_CISNE_SURFACE: 'prod',
        [FEATURE_FLAG_ENV[moduleId]]: 'true',
      })).toEqual({ enabled: true, origin: 'explicit-env' });
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
