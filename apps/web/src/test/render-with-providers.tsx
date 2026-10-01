import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { AuthProvider } from '../auth/context/AuthProvider';
import { SessionMetaBridge } from '../service-orders/context/SessionMetaBridge';
import type { ReactElement } from 'react';

type Options = RenderOptions & {
  router?: MemoryRouterProps;
};

/**
 * Renderiza com a MESMA pilha de providers do App real.
 *
 * `SessionMetaBridge` entrou aqui em B5: ele hidrata `/me` e `/command-catalog` quando há
 * sessão autenticada, e é o que permite às telas de OS consumirem `can()` e os rótulos de
 * comando vindos do backend. Sem ele, um componente que use `useSessionMeta` lançaria
 * "must be used within SessionMetaProvider" e o teste não refletiria o app.
 *
 * O `fetch` continua sendo o dublê do teste (`vi.stubGlobal`), então nenhuma chamada sai
 * para a rede.
 */
export function renderWithProviders(ui: ReactElement, options: Options = {}): RenderResult {
  const { router, ...renderOptions } = options;
  return render(
    <AuthProvider>
      <SessionMetaBridge>
        <MemoryRouter {...router}>{ui}</MemoryRouter>
      </SessionMetaBridge>
    </AuthProvider>,
    renderOptions,
  );
}
