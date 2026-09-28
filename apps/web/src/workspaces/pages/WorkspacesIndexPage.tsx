import { Link } from 'react-router-dom';
import { ModulePage } from '../../ui/module-layout';
import { WORK_DOMAIN_LABELS, WORK_DOMAINS } from '../../work-inbox/api/work-inbox-api';
import { DOMAIN_WORKSPACES, DOMAIN_WORKSPACE_PATHS } from '../domain-workspaces';

/**
 * TRABALHO POR DOMINIO — porta de entrada do conjunto de workspaces.
 *
 * Este indice NAO mostra contagem: numero aqui seria uma segunda leitura da mesma fila, e a
 * contagem de cada dominio pertence ao proprio workspace (zona AGORA). Aqui existe apenas o mapa
 * humano de "quem responde o que" — uma linha por dominio, sem cartao decorativo.
 *
 * O papel da Central de trabalho e o do Alert Center continuam onde estao: esta tela nao duplica
 * fila nem alerta, apenas distribui a entrada por dominio.
 */
export function WorkspacesIndexPage() {
  return (
    <ModulePage>
      <header className="mb-3">
        <h1 className="m-0 text-lg font-semibold text-gray-900">Trabalho por domínio</h1>
        <p className="m-0 text-xs text-gray-500">
          Cada domínio tem a sua tela: o que exige decisão agora, o que está travado e onde
          continuar. Tudo vem da mesma fila de trabalho.
        </p>
      </header>

      <ul className="m-0 list-none divide-y divide-gray-100 overflow-hidden rounded-lg bg-white p-0 shadow-sm ring-1 ring-gray-900/5">
        {WORK_DOMAINS.map((domain) => {
          const config = DOMAIN_WORKSPACES[domain];
          return (
            <li key={domain}>
              <Link
                to={DOMAIN_WORKSPACE_PATHS[domain]}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 no-underline hover:bg-gray-50"
              >
                <span className="text-sm font-semibold text-gray-900">
                  {WORK_DOMAIN_LABELS[domain]}
                </span>
                <span className="text-xs text-gray-500">{config.purpose}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-gray-500">
        A fila completa, com todos os domínios e filtros, fica na{' '}
        <Link className="font-semibold text-brand-700 no-underline" to="/app/work-inbox">
          Central de trabalho
        </Link>
        .
      </p>
    </ModulePage>
  );
}
