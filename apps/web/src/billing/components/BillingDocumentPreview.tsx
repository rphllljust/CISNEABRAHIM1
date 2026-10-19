import type { BillingDocumentPreviewModel } from '../utils/billing-document-preview';
import { NotaFaturaBrandMark } from './NotaFaturaBrandMark';
import {
  formatDateTimePtBr,
  formatMoneyBrl,
  formatQuantity,
  formatTaxId,
} from '../utils/billing-format';

type BillingDocumentPreviewProps = {
  model: BillingDocumentPreviewModel;
  printMode?: boolean;
};

/**
 * NOTA FATURA — representação impressa (A4).
 *
 * Espelha o PDF gerado pelo backend: mesma hierarquia de blocos, mesmos campos, mesmo rodapé.
 * A prévia é uma segunda montagem da MESMA composição — não uma tela diferente com outra
 * informação. Alterar um lado sem o outro faria o operador conferir uma coisa e o cliente
 * receber outra.
 *
 * Ausência de dado imprime travessão. Nenhum campo é preenchido por dedução.
 */
const ABSENT = '—';

function orAbsent(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : ABSENT;
}

function Field({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="nf-field">
      <span className="nf-field__label">{label}</span>
      <span className={strong ? 'nf-field__value nf-field__value--strong' : 'nf-field__value'}>
        {value}
      </span>
    </div>
  );
}

function statusLabel(status: string | null): string {
  if (!status) {
    return ABSENT;
  }
  const known: Record<string, string> = { FINALIZED: 'Emitida', CANCELLED: 'Cancelada' };
  return known[status] ?? status;
}

export function BillingDocumentPreview({ model, printMode = false }: BillingDocumentPreviewProps) {
  const rootClass = printMode
    ? 'billing-doc-preview nf-sheet nf-sheet--print'
    : 'billing-doc-preview nf-sheet';

  return (
    <article className={rootClass} aria-label="Pré-visualização da Nota Fatura">
      {/* ------------------------------------------------------------ CABEÇALHO */}
      <header className="nf-header">
        <div className="nf-header__emitter">
          <div className="nf-header__brand">
            <NotaFaturaBrandMark className="nf-header__mark" />
            <span className="nf-header__wordmark">CISNE</span>
          </div>
          <p className="nf-header__legal-name">{orAbsent(model.emitterLegalName)}</p>
          <p className="nf-header__line">CNPJ {formatTaxId(model.emitterTaxId)}</p>
          <p className="nf-header__line">{orAbsent(model.emitterAddressLine)}</p>
        </div>

        <div className="nf-header__doc">
          <p className="nf-header__doc-title">{model.documentCategory}</p>
          <p className="nf-header__doc-label">NÚMERO</p>
          <p className="nf-header__doc-number">{model.documentNumberLabel}</p>
          <p className="nf-header__doc-status">STATUS&nbsp;&nbsp;{statusLabel(model.status)}</p>
        </div>
      </header>

      {/* --------------------------------------------------------------- CLIENTE */}
      <section className="nf-section" aria-labelledby="nf-client-heading">
        <h3 id="nf-client-heading" className="nf-section__title">
          Dados do cliente
        </h3>
        <div className="nf-client">
          <div className="nf-client__identity">
            <p className="nf-client__name">{orAbsent(model.clientLegalName)}</p>
            <Field label="CNPJ / CPF" value={formatTaxId(model.clientTaxId)} strong />
          </div>
          <div className="nf-client__address">
            <Field label="Endereço de cobrança" value={orAbsent(model.billingAddressLine)} />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- IDENTIFICAÇÃO */}
      <section className="nf-section" aria-labelledby="nf-ident-heading">
        <h3 id="nf-ident-heading" className="nf-section__title">
          Identificação
        </h3>
        <div className="nf-grid nf-grid--4">
          <Field label="Documento" value={model.documentNumberLabel} strong />
          <Field label="Status" value={statusLabel(model.status)} strong />
          <Field
            label="Emissão"
            value={model.issuedAt ? formatDateTimePtBr(model.issuedAt) : ABSENT}
            strong
          />
          <Field label="Vencimento" value={orAbsent(model.dueDate)} />
        </div>
        <div className="nf-grid nf-grid--4">
          <Field label="Ordem de serviço" value={orAbsent(model.serviceOrderNumber)} />
          <Field label="Medição" value={orAbsent(model.measurementNumber)} />
          <Field label="Período de execução" value={orAbsent(model.servicePeriodLabel)} />
          <Field label="Proposta" value={orAbsent(model.proposalNumber)} />
        </div>
        <div className="nf-grid nf-grid--4">
          {/* Pedido DO CLIENTE e pedido INTERNO são fatos distintos: nunca no mesmo rótulo. */}
          <Field
            label="Pedido do cliente"
            value={orAbsent(model.customerPurchaseOrderNumber)}
            strong
          />
          {/* Rótulo CRU. A governança do CISNE registra RC como não evidenciado, então o
              documento não afirma se é referência do cliente ou interna. */}
          <Field label="RC" value={orAbsent(model.rcNumber)} />
          <Field label="Pedido interno CISNE" value={orAbsent(model.purchaseOrderNumber)} />
          <Field label="Referência contratual" value={orAbsent(model.contractReference)} />
        </div>
      </section>

      {/* ------------------------------------------------------------ PAGAMENTO */}
      <section className="nf-section" aria-labelledby="nf-pay-heading">
        <h3 id="nf-pay-heading" className="nf-section__title">
          Condições de pagamento
        </h3>
        <div className="nf-grid nf-grid--3">
          <Field label="Condição de pagamento" value={orAbsent(model.paymentTerms)} strong />
          <Field label="Vencimento" value={orAbsent(model.dueDate)} strong />
          <Field label="Moeda" value={model.currencyCode} />
        </div>
      </section>

      {/* ----------------------------------------------------------------- ITENS */}
      <section className="nf-section" aria-labelledby="nf-items-heading">
        <h3 id="nf-items-heading" className="nf-section__title">
          Itens e valores
        </h3>
        <table className="nf-table">
          <thead>
            <tr>
              <th scope="col" className="nf-table__line">
                #
              </th>
              <th scope="col">Descrição</th>
              <th scope="col" className="nf-table__num">
                Qtd
              </th>
              <th scope="col">Un.</th>
              <th scope="col" className="nf-table__num">
                Preço unit.
              </th>
              <th scope="col" className="nf-table__num">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {model.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="nf-table__empty">
                  Nenhum item registrado neste documento.
                </td>
              </tr>
            ) : (
              model.items.map((item) => (
                <tr key={item.id}>
                  <td className="nf-table__line">{item.lineNumber}</td>
                  <td>{orAbsent(item.description)}</td>
                  <td className="nf-table__num">
                    {formatQuantity(item.quantity, item.unitCode)}
                  </td>
                  <td>{orAbsent(item.unitCode)}</td>
                  <td className="nf-table__num">
                    {item.unitPrice ? formatMoneyBrl(item.unitPrice, model.currencyCode) : ABSENT}
                  </td>
                  <td className="nf-table__num nf-table__amount">
                    {formatMoneyBrl(item.lineAmount, model.currencyCode)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="nf-totals">
          <p className="nf-totals__count">Itens: {model.items.length}</p>
          <div className="nf-totals__box">
            <span className="nf-totals__label">Total do documento</span>
            <span className="nf-totals__value">
              {formatMoneyBrl(model.totalAmount, model.currencyCode)}
            </span>
          </div>
        </div>
      </section>

      <footer className="nf-footer">
        <p className="nf-footer__disclaimer">{model.fiscalDisclaimer}</p>
        <p className="nf-footer__number">{model.documentNumberLabel}</p>
      </footer>
    </article>
  );
}
