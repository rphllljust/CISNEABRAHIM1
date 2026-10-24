import { describe, expect, it } from 'vitest';
import { SHELL_NAV_GROUPS, SHELL_NAV_ITEMS } from './nav-config';
import { isNavItemVisible } from './useNavAccess';

/**
 * SIDEBAR — Financeiro precisa aparecer na barra lateral.
 *
 * CONTEXTO MEDIDO
 *
 * A rota `/app/finance` abre em producao, o RBAC responde 200 e a API serve o modulo.
 * O RBAC foi provado com identidade real (run 40045807309):
 *
 *   /api/v1/finance/receivables    -> HTTP 200
 *   /api/v1/finance/payables       -> HTTP 200
 *   /api/v1/finance/treasury/accounts -> HTTP 200
 *
 * Entao o defeito, se existe, esta entre `access['finance-overview']` e o DOM da sidebar.
 * Estes testes fixam essa cadeia para que qualquer regressao apareca aqui, e nao na tela
 * do operador.
 */

const FINANCE_ALTURA = { 'finance-overview': true };

describe('sidebar: item Financeiro', () => {
  it('declare o item no grupo empresarial Financeiro', () => {
    const group = SHELL_NAV_GROUPS.find((entry) => entry.id === 'finance');
    expect(group, 'grupo finance deveria existir').toBeTruthy();
    expect(group?.label).toBe('Financeiro');

    const item = group?.items.find((entry) => entry.id === 'finance-overview');
    expect(item, 'item finance-overview deveria existir').toBeTruthy();
    expect(item?.label).toBe('Financeiro');
    expect(item?.path).toBe('/app/finance');
    expect(item?.featureFlag).toBe('finance');
    expect(item?.accessCheck).toBe('finance-overview');
  });

  it('aparece quando a flag esta ligada e o acesso foi autorizado', () => {
    // O estado real de producao: VITE_FEATURE_MODULE_FINANCE=true (medido no bundle
    // servido) e a sonda composta autorizada (HTTP 200 nas tres rotas).
    expect(isNavItemVisible('finance-overview', FINANCE_ALTURA, false)).toBe(true);
  });

  it('nao aparece enquanto a resolucao esta em andamento', () => {
    // `loading=true` e fail-closed: o item entra quando o veredito chega, nunca antes.
    expect(isNavItemVisible('finance-overview', FINANCE_ALTURA, true)).toBe(false);
  });

  it('nao aparece quando o acesso foi negado', () => {
    expect(isNavItemVisible('finance-overview', { 'finance-overview': false }, false)).toBe(false);
  });

  it('aparece no grupo, nao solto: o agrupamento e empresarial', () => {
    const group = SHELL_NAV_GROUPS.find((entry) => entry.id === 'finance');
    const visibleInGroup = (group?.items ?? []).filter((item) =>
      isNavItemVisible(item.id, FINANCE_ALTURA, false),
    );
    // O item de entrada do modulo precisa estar no grupo, senao a navegacao lateral
    // mostraria atalhos sem o modulo que os contem.
    expect(visibleInGroup.map((item) => item.label)).toContain('Financeiro');
  });

  it('o item de entrada tem prioridade sobre os filhos na lista', () => {
    const group = SHELL_NAV_GROUPS.find((entry) => entry.id === 'finance');
    const first = group?.items[0];
    // O primeiro item do grupo e a porta de entrada do modulo. Se um filho
    // (Contas a Receber, etc.) viesse antes, a sidebar mostraria submenu sem o modulo.
    expect(first?.id).toBe('finance-overview');
    expect(first?.path).toBe('/app/finance');
  });

  it('todos os itens de finance apontam para rotas sob /app/finance', () => {
    const group = SHELL_NAV_GROUPS.find((entry) => entry.id === 'finance');
    for (const item of group?.items ?? []) {
      expect(item.path.startsWith('/app/finance')).toBe(true);
    }
  });

  it('nao ha item duplicado chamado Financeiro em outro grupo', () => {
    // Duplicata faria o modulo aparecer em dois lugares e confundiria o operador
    // sobre onde o trabalho acontece.
    const financeiros = SHELL_NAV_ITEMS.filter((item) => item.label === 'Financeiro');
    expect(financeiros.length).toBe(1);
    expect(financeiros[0]?.id).toBe('finance-overview');
  });
});
