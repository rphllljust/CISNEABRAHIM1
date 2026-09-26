import { describe, expect, it } from 'vitest';
import { OPERATIONAL_PROFILE_GRANTS } from './operational-profiles';

/**
 * SEGREGACAO DE FUNCOES NOS PERFIS DE DESENVOLVIMENTO
 *
 * Regressao do defeito encontrado em 2026-09-25: `EMPREGADO_GRANTS` estava definido como
 * `CONTROLE_GRANTS` e `CONTROLE_FINANCEIRO` recebia o conjunto do dono, de modo que o
 * empregado e o controlador financeiro tinham acesso GLOBAL a financeiro, contabil, fiscal,
 * comercial e catalogo. O banco de desenvolvimento chegou a materializar 263 grants GLOBAL
 * identicos para os tres logins.
 *
 * O contrato verificado aqui e o vocabulario de acoes (nao o banco): cada perfil so pode
 * declarar acoes do proprio dominio.
 */

const DOMINIOS_FORA_DO_EMPREGADO = [
  'finance:',
  'accounting:',
  'fiscal:',
  'commercial:',
  'catalog:',
  'client:',
  'requests:',
  'people:',
  'billing:',
  'measurements:',
  'access-admin:',
] as const;

const DOMINIOS_FORA_DO_CONTROLE_FINANCEIRO = [
  'accounting:',
  'fiscal:',
  'commercial:',
  'catalog:',
  'client:',
  'requests:',
  'people:',
  'resources:',
  'access-admin:',
] as const;

function acoes(perfil: keyof typeof OPERATIONAL_PROFILE_GRANTS): string[] {
  return OPERATIONAL_PROFILE_GRANTS[perfil].map((entrada) => entrada.action);
}

describe('perfis operacionais de desenvolvimento — segregacao de funcoes', () => {
  it('empregado opera apenas as ordens atribuidas (ASSIGNED), sem dominio financeiro/contabil/fiscal', () => {
    const empregado = OPERATIONAL_PROFILE_GRANTS.empregado;
    expect(empregado.length).toBeGreaterThan(0);

    for (const entrada of empregado) {
      const acao = entrada.action;
      for (const prefixo of DOMINIOS_FORA_DO_EMPREGADO) {
        expect(acao.startsWith(prefixo), `empregado nao pode ter ${acao}`).toBe(false);
      }
    }

    // Toda acao de ordem de servico do empregado e escopada por ASSIGNED.
    const acoesDeOs = empregado.filter((entrada) => entrada.action.startsWith('service-orders:'));
    expect(acoesDeOs.length).toBeGreaterThan(0);
    for (const entrada of acoesDeOs) {
      expect(entrada.scopeType, `${entrada.action} deve ser ASSIGNED`).toBe('ASSIGNED');
    }

    // Nunca GLOBAL no recurso de ordem de servico.
    const globalEmOs = empregado.filter(
      (entrada) =>
        entrada.action.startsWith('service-orders:') && (entrada.scopeType ?? 'GLOBAL') === 'GLOBAL',
    );
    expect(globalEmOs).toEqual([]);
  });

  it('controlador financeiro tem o dominio financeiro e nada de catalogo/comercial/contabil/fiscal', () => {
    const financeiro = OPERATIONAL_PROFILE_GRANTS.controleFinanceiro;
    expect(financeiro.length).toBeGreaterThan(0);

    const acoesFinanceiras = financeiro.filter((entrada) => entrada.action.startsWith('finance:'));
    expect(acoesFinanceiras.length).toBeGreaterThan(0);

    for (const entrada of financeiro) {
      const acao = entrada.action;
      for (const prefixo of DOMINIOS_FORA_DO_CONTROLE_FINANCEIRO) {
        expect(acao.startsWith(prefixo), `controlador financeiro nao pode ter ${acao}`).toBe(false);
      }
    }
  });

  it('perfis nao sao o mesmo conjunto (defeito historico: EMPREGADO = CONTROLE)', () => {
    const controle = new Set(acoes('controle'));
    const empregado = acoes('empregado');
    const financeiro = acoes('controleFinanceiro');

    expect(empregado.length).toBeLessThan(controle.size);
    expect(financeiro.length).toBeLessThan(controle.size);

    const empregadoForaDoControle = empregado.filter((acao) => !controle.has(acao));
    expect(empregadoForaDoControle.length).toBeGreaterThan(0);

    // Acoes sensiveis (dinheiro/contabilidade) nunca podem ser compartilhadas com o dono:
    // criar documento/evidencia e legitimo para o empregado, liquidar ou lancar nao e.
    const verbosSensiveis = [':settle', ':post', ':reverse', ':approve', ':pay', ':finalize', ':cancel'];
    const compartilhadasSensiveis = OPERATIONAL_PROFILE_GRANTS.empregado.filter(
      (entrada) =>
        controle.has(entrada.action) &&
        verbosSensiveis.some((verbo) => entrada.action.endsWith(verbo)),
    );
    expect(compartilhadasSensiveis).toEqual([]);
  });

  it('controlador financeiro nao consegue aprovar e executar a mesma operacao sensivel sozinho', () => {
    // O controle operacional (dono) e quem opera catalogo, comercial e OS; o controlador
    // financeiro opera o dinheiro. Os dois conjuntos nao podem coincidir no dominio comercial.
    const financeiro = new Set(acoes('controleFinanceiro'));
    for (const acao of ['commercial:proposal:create', 'commercial:purchase-order:create']) {
      expect(financeiro.has(acao), `controlador financeiro nao pode ter ${acao}`).toBe(false);
    }
  });
});
