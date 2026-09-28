import { Link } from 'react-router-dom';
import type { ProposalItem, ProposalVersion } from '../types/proposal.types';
import { formatMoney, formatProposalPricingStructure } from '../utils/proposal-labels';
import { formatProposalItemKind } from '../utils/proposal-composition';

type ProposalCommercialItemsProps = {
  version: ProposalVersion;
};

/**
 * Composicao comercial da revisao vigente.
 *
 * Mostra o que esta sendo ofertado: item, quantidade, unidade, preco unitario e subtotal, conforme
 * os dados REAIS da versao. Custo interno e margem NAO sao exibidos: nao existe concessao de
 * autorizacao especifica para custo/margem no modulo, e sem essa prova o dado nao vai para a tela.
 */
export function ProposalCommercialItems({ version }: ProposalCommercialItemsProps) {
  if (version.items.length === 0) {
    return (
      <p className="text-sm text-gray-500" role="status">
        {version.pricingStructure === 'GLOBAL_PRICE'
          ? 'Proposta de preço global: a composição é o valor fechado da revisão, sem itens detalhados.'
          : 'Nenhum item registrado nesta revisão.'}
      </p>
    );
  }

  const saleTotal =
    version.itemsSaleTotal ??
    version.items
      .reduce((sum, item) => {
        const amount = Number.parseFloat(item.lineSaleAmount ?? '0');
        return sum + (Number.isNaN(amount) ? 0 : amount);
      }, 0)
      .toFixed(4);

  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">
        Estrutura de preço: {formatProposalPricingStructure(version.pricingStructure)} ·{' '}
        {version.items.length} item(ns)
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Composição comercial da proposta">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] tracking-wide text-gray-500 uppercase">
              <th scope="col" className="py-1.5 pr-3">
                Item
              </th>
              <th scope="col" className="py-1.5 pr-3">
                Serviço
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right">
                Qtd.
              </th>
              <th scope="col" className="py-1.5 pr-3">
                Un.
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right">
                Preço
              </th>
              <th scope="col" className="py-1.5 text-right">
                Subtotal
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {version.items.map((item) => (
              <tr key={item.id}>
                <td className="py-2 pr-3 text-gray-600 tabular-nums">{item.lineNumber}</td>
                <td className="py-2 pr-3">
                  <span className="block font-medium text-gray-900">{item.description}</span>
                  <span className="text-[11px] text-gray-500">
                    {formatProposalItemKind(item.itemKind)}
                    {item.serviceDefinitionId ? (
                      <>
                        {' · '}
                        <Link
                          to={`/app/catalog`}
                          className="text-brand-700 no-underline hover:text-brand-800"
                        >
                          {serviceLabel(item)}
                        </Link>
                      </>
                    ) : null}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right text-gray-700 tabular-nums">
                  {item.quantity ?? '—'}
                </td>
                <td className="py-2 pr-3 text-gray-600">{item.unitCode ?? '—'}</td>
                <td className="py-2 pr-3 text-right text-gray-700 tabular-nums">
                  {formatMoney(item.unitSalePrice, version.currencyCode)}
                </td>
                <td className="py-2 text-right font-medium text-gray-900 tabular-nums">
                  {formatMoney(item.lineSaleAmount, version.currencyCode)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="pt-2 text-right text-xs font-medium text-gray-600">
                Total comercial
              </td>
              <td className="pt-2 text-right text-sm font-semibold text-gray-900 tabular-nums">
                {formatMoney(saleTotal, version.currencyCode)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function serviceLabel(item: ProposalItem): string {
  const snapshot = item.serviceSnapshot;
  if (snapshot && typeof snapshot['name'] === 'string') {
    return typeof snapshot['code'] === 'string' ? `${snapshot['code']} ${snapshot['name']}` : snapshot['name'];
  }
  return 'Serviço do catálogo';
}
