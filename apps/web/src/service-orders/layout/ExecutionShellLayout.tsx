import { Link, Outlet, useParams } from 'react-router-dom';
import { serviceOrderStagePath } from '../utils/service-order-next-action';

/**
 * CASCO DA EXECUCAO EM CAMPO.
 *
 * Execucao e uma superficie de campo: o operador esta com o aparelho na mao e nao
 * pode ser jogado de volta ao painel ao terminar o apontamento, nem precisar do
 * menu do sistema para seguir o trabalho. O casco mantem a ORDEM DE SERVICO como
 * contexto e oferece as etapas irmas por clique.
 *
 * O estado da OS nao e conhecido aqui (nao ha leitura de ordem neste componente),
 * entao a etapa NAO e marcada como ativa: inventar "voce esta em execucao" sem o
 * estado real seria afirmar o que nao foi lido. Os links sao navegacao, nao estado.
 */

type StageLink = {
  stage: 'planning' | 'execution' | 'measurement';
  label: string;
};

const STAGE_LINKS: StageLink[] = [
  { stage: 'planning', label: 'Planejamento' },
  { stage: 'execution', label: 'Execução' },
  { stage: 'measurement', label: 'Medição' },
];

export function ExecutionShellLayout() {
  const { serviceOrderId = '' } = useParams();

  return (
    <div className="execution-shell">
      <a className="skip-link" href="#execution-main">
        Ir para conteúdo da execução
      </a>
      <header className="execution-shell__header">
        <Link
          to={serviceOrderId ? serviceOrderStagePath(serviceOrderId, 'planning') : '/app/service-orders'}
          className="execution-shell__back"
        >
          {serviceOrderId ? 'Ordem de serviço' : 'Ordens de serviço'}
        </Link>
        <p className="execution-shell__brand">Execução em campo</p>
      </header>

      {serviceOrderId ? (
        <nav className="execution-shell__stages" aria-label="Etapas da ordem de serviço">
          {STAGE_LINKS.map(({ stage, label }) => (
            <Link key={stage} to={serviceOrderStagePath(serviceOrderId, stage)}>
              {label}
            </Link>
          ))}
          <Link to={`/app/service-orders/${serviceOrderId}/billing`}>Faturamento</Link>
        </nav>
      ) : null}

      <main id="execution-main" className="execution-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
