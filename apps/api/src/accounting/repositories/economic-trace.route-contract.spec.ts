import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ECONOMIC_TRACE_ROUTE_BASE } from './economic-trace.read-model';

/**
 * O CONTRATO DE ROTA ENTRE BACKEND E FRONTEND.
 *
 * Este teste existe por causa de um defeito real: o backend emitia
 * `/app/finance/economic-trace/...` enquanto o roteador do React registrava
 * `/app/accounting/economic-trace/:factKind/:factId`. Nenhum dos dois lados estava
 * "errado" isoladamente — e por isso nenhum teste de unidade pegava. O resultado era
 * o pior tipo de falha: a worklist mostrava o link "Trilha" habilitado e todo clique
 * levava a uma rota inexistente.
 *
 * A correção não pode depender de alguém lembrar dos dois arquivos. Este teste lê a
 * DEFINIÇÃO REAL do roteador e compara. Se um lado mudar sozinho, isto fica vermelho.
 */
describe('rota da trilha econômica — backend e frontend falam o mesmo caminho', () => {
  it('a base emitida pelo backend existe no roteador da aplicação', () => {
    // apps/api/src/accounting/repositories → apps/web/src/AppRoutes.tsx
    const appRoutesPath = join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'web',
      'src',
      'AppRoutes.tsx',
    );
    const source = readFileSync(appRoutesPath, 'utf8');

    const registeredTraceRoute = 'path="/app/accounting/economic-trace/:factKind/:factId"';
    expect(source).toContain(registeredTraceRoute);

    // A base do backend precisa ser o PREFIXO dessa rota registrada.
    expect(ECONOMIC_TRACE_ROUTE_BASE).toBe('/app/accounting/economic-trace');
    expect(registeredTraceRoute).toContain(`path="${ECONOMIC_TRACE_ROUTE_BASE}/`);
  });

  it('a base não aponta para um domínio que não possui a rota', () => {
    // FINANCE publica o FATO; quem decide e mostra o posting é a CONTROLADORIA.
    // Um endereço em `/app/finance/...` levaria o operador a uma área que não
    // hospeda esta trilha.
    expect(ECONOMIC_TRACE_ROUTE_BASE.startsWith('/app/accounting/')).toBe(true);
  });
});
