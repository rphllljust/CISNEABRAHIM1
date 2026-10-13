import { Link } from 'react-router-dom';
import { ModulePage } from '../../ui/module-layout';
import { WorklistHeader } from '../../ui/enterprise-list';
import { workbenchSecondaryActionClass } from '../../ui/workbench';
import type { WorkDomain } from '../../work-inbox/api/work-inbox-api';
import { DomainWorkZones } from '../components/DomainWorkZones';
import { WorkspaceQueueZone } from '../components/WorkspaceQueueZone';
import { DOMAIN_WORKSPACES } from '../domain-workspaces';

/**
 * WORKSPACE DE DOMINIO — superficie de DECISAO e de TRABALHO de um dominio.
 *
 * A ordem e a da propria decisao operacional, e nao a do menu:
 *
 *   1. AGORA / ATENCAO / CONTINUAR  -> onde o dominio esta (as zonas que ja existiam);
 *   2. FILA DE TRABALHO             -> onde o trabalho ACONTECE.
 *
 * A fila entra DEPOIS das zonas e nao no lugar delas: o operador primeiro entende o estado do
 * dominio e depois trabalha os itens — o inverso faria a tela abrir sem contexto. Mas ela entra, e
 * essa e a correcao: sem fila, o workspace era so leitura, e o operador tinha de sair para a
 * Central de trabalho para executar qualquer coisa.
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
      <WorkspaceQueueZone domain={domain} />
    </ModulePage>
  );
}
