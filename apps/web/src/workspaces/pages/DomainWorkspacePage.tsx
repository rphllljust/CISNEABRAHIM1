import { Link } from 'react-router-dom';
import { ModulePage } from '../../ui/module-layout';
import { WorklistHeader } from '../../ui/enterprise-list';
import { workbenchSecondaryActionClass } from '../../ui/workbench';
import type { WorkDomain } from '../../work-inbox/api/work-inbox-api';
import { DomainWorkZones } from '../components/DomainWorkZones';
import { DOMAIN_WORKSPACES } from '../domain-workspaces';

/**
 * WORKSPACE DE DOMINIO — superficie de decisao de um dominio.
 *
 * Nao e dashboard e nao e menu: abre com identidade operacional, depois AGORA, ATENCAO e
 * CONTINUAR sobre a mesma fila autoritativa. O link do cabecalho preserva o drilldown para o
 * recorte completo sem duplicar consulta nem regra.
 */
export function DomainWorkspacePage({ domain }: { domain: WorkDomain }) {
  const config = DOMAIN_WORKSPACES[domain];

  return (
    <ModulePage layout="workspace">
      <WorklistHeader
        title={config.title}
        context={config.purpose}
        action={
          <Link
            to={`/app/work-inbox?domain=${domain}`}
            className={workbenchSecondaryActionClass}
          >
            Abrir fila completa
          </Link>
        }
      />

      <DomainWorkZones domain={domain} />
    </ModulePage>
  );
}
