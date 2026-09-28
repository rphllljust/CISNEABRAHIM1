import { ModulePage } from '../../ui/module-layout';
import type { WorkDomain } from '../../work-inbox/api/work-inbox-api';
import { DomainWorkZones } from '../components/DomainWorkZones';
import { DOMAIN_WORKSPACES } from '../domain-workspaces';

/**
 * WORKSPACE DE DOMINIO — superficie de decisao de um dominio.
 *
 * Nao e um dashboard: e a resposta em tres zonas (AGORA, ATENCAO, CONTINUAR) montada sobre a
 * fila de trabalho que ja existe. Todos os seis dominios usam ESTE componente — um lugar unico
 * garante que nenhum deles invente contagem, esconda indisponibilidade ou vire menu de cartoes.
 *
 * O financeiro tambem usa as mesmas zonas, mas vive em `/app/finance` e acrescenta a posicao
 * financeira depois do trabalho (ver `FinanceOverviewPage`).
 */
export function DomainWorkspacePage({ domain }: { domain: WorkDomain }) {
  const config = DOMAIN_WORKSPACES[domain];

  return (
    <ModulePage>
      <header className="mb-3">
        <h1 className="m-0 text-lg font-semibold text-gray-900">{config.title}</h1>
        <p className="m-0 text-xs text-gray-500">{config.purpose}</p>
      </header>

      <DomainWorkZones domain={domain} />
    </ModulePage>
  );
}
