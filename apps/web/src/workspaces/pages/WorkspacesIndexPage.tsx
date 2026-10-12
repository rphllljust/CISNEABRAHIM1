import { Link } from 'react-router-dom';
import { ModulePage } from '../../ui/module-layout';
import { WorklistHeader } from '../../ui/enterprise-list';
import {
  WorkbenchQueue,
  WorkbenchQueueItem,
  workbenchPrimaryActionClass,
  workbenchSecondaryActionClass,
} from '../../ui/workbench';
import { WORK_DOMAIN_LABELS, WORK_DOMAINS } from '../../work-inbox/api/work-inbox-api';
import { DOMAIN_WORKSPACES, DOMAIN_WORKSPACE_PATHS } from '../domain-workspaces';

/**
 * TRABALHO POR DOMINIO — switchboard operacional.
 *
 * Nao busca contagem aqui: cada dominio continua dono da propria leitura autoritativa. Esta tela
 * reduz procura e navegacao: uma linha por workspace, objetivo claro, entrada primaria e atalhos
 * para as listas reais por onde o trabalho continua.
 */
export function WorkspacesIndexPage() {
  return (
    <ModulePage>
      <WorklistHeader
        title="Trabalho por domínio"
        count={WORK_DOMAINS.length}
        context="Workspaces operacionais por processo. Entre no domínio para decidir; use os atalhos para continuar trabalho já conhecido."
        action={
          <Link to="/app/work-inbox" className={workbenchSecondaryActionClass}>
            Central de trabalho
          </Link>
        }
      />

      <WorkbenchQueue
        title="Workspaces operacionais"
        count={WORK_DOMAINS.length}
        description="Cada linha abre uma superfície de decisão; os atalhos levam direto às filas e objetos reais do domínio."
      >
        {WORK_DOMAINS.map((domain) => {
          const config = DOMAIN_WORKSPACES[domain];
          return (
            <WorkbenchQueueItem
              key={domain}
              title={WORK_DOMAIN_LABELS[domain]}
              reason={config.purpose}
              context={
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {config.shortcuts.slice(0, 4).map((shortcut) => (
                    <Link
                      key={shortcut.to}
                      to={shortcut.to}
                      className={workbenchSecondaryActionClass}
                    >
                      {shortcut.label}
                    </Link>
                  ))}
                  {config.shortcuts.length > 4 ? (
                    <span className="cisne-type-helper">
                      +{config.shortcuts.length - 4} no workspace
                    </span>
                  ) : null}
                </span>
              }
              action={
                <Link
                  to={DOMAIN_WORKSPACE_PATHS[domain]}
                  aria-label={`${WORK_DOMAIN_LABELS[domain]} — abrir workspace`}
                  className={workbenchPrimaryActionClass}
                >
                  Abrir workspace
                </Link>
              }
            />
          );
        })}
      </WorkbenchQueue>
    </ModulePage>
  );
}
