import { Link } from 'react-router-dom';
import { ModulePage } from '../../ui/module-layout';
import { WorklistHeader } from '../../ui/enterprise-list';
import { workbenchSecondaryActionClass } from '../../ui/workbench';
import type { WorkDomain } from '../../work-inbox/api/work-inbox-api';
import { DomainWorkZones } from '../components/DomainWorkZones';
import { WorkspaceQueueSurface } from '../components/WorkspaceQueueSurface';
import { DOMAIN_WORKSPACES } from '../domain-workspaces';

/**
 * WORKSPACE DE DOMINIO — superficie de DECISAO e de TRABALHO de um dominio.
 *
 * A ordem e a da propria decisao operacional, e nao a do menu:
 *
 *   1. AGORA / ATENCAO / CONTINUAR  -> onde o dominio esta;
 *   2. FILA DE TRABALHO             -> onde o trabalho ACONTECE.
 *
 * A fila entra DEPOIS das zonas e nao no lugar delas: o operador primeiro entende o estado do
 * dominio e depois trabalha os itens — o inverso faria a tela abrir sem contexto. Mas ela entra, e
 * essa e a correcao: sem fila, o workspace era so leitura, e o operador tinha de sair para a Central
 * de trabalho para executar qualquer coisa.
 *
 * A fila em si NAO e escrita aqui: ela e a `WorkspaceQueueSurface`, a mesma superficie que o
 * workspace financeiro usa. Este arquivo diz apenas QUAL dominio a zona mostra.
 */
export function DomainWorkspacePage({ domain }: { domain: WorkDomain }) {
  const config = DOMAIN_WORKSPACES[domain];

  return (
    <ModulePage layout="workspace">
      <WorklistHeader
        title={config.title}
        context={config.purpose}
        action={
          <Link to={`/app/work-inbox?domain=${domain}`} className={workbenchSecondaryActionClass}>
            Abrir fila completa
          </Link>
        }
      />

      <DomainWorkZones domain={domain} />

      <WorkspaceQueueSurface
        title="Fila de trabalho"
        description="Exceções e decisões reais do domínio"
        savedViewsScope={`workspace.${domain}`}
        scopeSource="local"
        lockDomain={domain}
      />
    </ModulePage>
  );
}
