import type { ExecutiveDashboardSnapshot } from '../types/dashboard.types';

type FiscalPanelProps = {
  snapshot: ExecutiveDashboardSnapshot;
};

/**
 * FISCAL / CONTÁBIL — somente o que o snapshot composto ja publica.
 *
 * As metricas fiscais/contabeis do catalogo (documentos pendentes de transmissao,
 * obrigacoes abertas, periodos abertos, lancamentos em rascunho) NAO fazem parte
 * do payload executivo atual. Enquanto isso, esta secao declara o recorte como
 * fora do snapshot — nunca exibe zero e nunca estima obrigacao nem periodo.
 *
 * Por ser PARK_BI_GAP, ela NAO reserva area: renderiza uma unica linha. Se o
 * snapshot passar a publicar documento fiscal pendente como excecao, a linha
 * mostra a contagem real que o servidor entregou.
 */
export function FiscalPanel({ snapshot }: FiscalPanelProps) {
  const pendingDocuments = snapshot.attention.find((item) => item.id === 'pending-documents');

  return (
    <section aria-labelledby="fiscal-heading" className="dashboard-block dashboard-block--compact">
      <header className="dashboard-section-head">
        <h2 id="fiscal-heading" className="dashboard-section-head__title">
          Fiscal e contábil
        </h2>
      </header>
      <p className="dashboard-fiscal__line">
        {pendingDocuments
          ? `${pendingDocuments.count} documentos fiscais pendentes no escopo autorizado.`
          : 'Documentos fiscais pendentes, obrigações abertas e períodos contábeis ainda não são publicados no snapshot executivo (PARK_BI_GAP). Nenhum número é estimado aqui.'}
      </p>
    </section>
  );
}
