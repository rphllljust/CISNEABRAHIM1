import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { AuthProvider } from '../auth/context/AuthProvider';
import { MetadataProvider } from '../engine';
import { SessionMetaBridge } from '../service-orders/context/SessionMetaBridge';
import type { ReactElement } from 'react';

type Options = RenderOptions & {
  router?: MemoryRouterProps;
  /**
   * Monta o `MetadataProvider` da engine. OPT-IN.
   *
   * O provider dispara `GET /api/v1/meta/:entity` assim que um componente chama
   * `useEntitySchema`. Numa suíte que não serve essa rota a chamada nunca resolve, e o teste
   * passaria a medir uma tela parada em "Carregando…" — um vermelho que não corresponde a defeito
   * nenhum do produto. Sendo opt-in, quem testa uma tela dirigida por metadados pede o provider
   * (`{ metadata: true }`) e as demais suítes não são afetadas por uma mudança de harness.
   */
  metadata?: boolean;
};

/**
 * Renderiza com a MESMA pilha de providers do App real.
 *
 * `SessionMetaBridge` entrou aqui em B5: ele hidrata `/me` e `/command-catalog` quando há
 * sessão autenticada, e é o que permite às telas de OS consumirem `can()` e os rótulos de
 * comando vindos do backend. Sem ele, um componente que use `useSessionMeta` lançaria
 * "must be used within SessionMetaProvider" e o teste não refletiria o app.
 *
 * `metadata` monta o `MetadataProvider` da engine — ver `Options.metadata`. É ele quem carrega
 * `GET /api/v1/meta/:entity`; sem ele `useEntitySchema` devolve `null` para sempre, e uma tela
 * renderizada pela engine ficaria presa em "Carregando…" em vez de desenhar a grade.
 *
 * O `fetch` continua sendo o dublê do teste (`vi.stubGlobal`), então nenhuma chamada sai
 * para a rede.
 */
export function renderWithProviders(ui: ReactElement, options: Options = {}): RenderResult {
  const { router, metadata = false, ...renderOptions } = options;
  return render(
    <AuthProvider>
      <SessionMetaBridge>
        <MemoryRouter {...router}>
          {metadata ? <MetadataProvider>{ui}</MetadataProvider> : ui}
        </MemoryRouter>
      </SessionMetaBridge>
    </AuthProvider>,
    renderOptions,
  );
}
