import { Link } from 'react-router-dom';
import { BusinessChain } from '../../business-chain/BusinessChain';
import { useBusinessChain } from '../../business-chain/use-business-chain';
import { ServiceOrderStatusBadge } from './ServiceOrderStatusBadge';
import { formatServiceOrderStatus } from '../utils/service-order-labels';
import { isTechnicalIdentity } from '../../shell/format-identity';
import { DateTime } from '../../ui';
import type { ServiceOrderSummary } from '../api/service-orders-api';

/**
 * CONTEXTO DA ORDEM DE SERVIÇO — cliente, contrato e CADEIA DE NEGÓCIO.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO NAO E A OBJECT PAGE
 *
 * A fila entrega o suficiente para decidir. O que ela NAO entrega sozinha e a LIGAÇÃO da ordem com
 * o resto do negócio — de onde ela veio e o que ela produz:
 *
 *   solicitação -> proposta -> pedido de compra -> ordem de serviço -> medição -> faturamento
 *
 * Essa linhagem é o que transforma "uma OS" em "o elo de um processo". Ela já existia no produto
 * (`GET /business-chain`), mas vivia presa à object page: o operador que trabalhava na fila tinha de
 * sair da fila para descobrir de onde a ordem veio. Aqui a cadeia é lida onde a decisão acontece.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * HONESTIDADE
 *
 * - UMA requisição de cadeia por ordem selecionada. Nada é montado no navegador.
 * - Falha de leitura NÃO vira cadeia vazia: `phase` distingue negação, erro e ausência, e o painel
 *   diz o que houve. "Sem cadeia" só é afirmado quando o servidor respondeu e não havia elo.
 * - O cliente aparece pelo NOME quando o snapshot publicado pelo servidor o traz. Sem snapshot,
 *   a tela diz que o cliente está identificado no cadastro — nunca inventa razão social nem
 *   transforma identificador técnico em rótulo humano.
 */

/** Nome humano do cliente, a partir do snapshot REAL publicado pelo servidor. */
export function clientDisplayName(order: ServiceOrderSummary): string | null {
  const snapshot = order.clientSnapshot;
  if (!snapshot) {
    return null;
  }
  for (const key of ['name', 'legalName', 'tradeName', 'displayName']) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

/** Rótulo curto de localização — só quando o servidor publica um campo legível. */
function locationLabel(order: ServiceOrderSummary): string | null {
  const location = order.location;
  if (!location) {
    return null;
  }
  for (const key of ['name', 'label', 'addressLabel', 'siteName']) {
    const value = location[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

export function OperationsObjectContext({ order }: { order: ServiceOrderSummary }) {
  const { chain, phase, message, retry } = useBusinessChain('SERVICE_ORDER', order.id);
  const client = clientDisplayName(order);
  const location = locationLabel(order);

  return (
    <div className="flex flex-col gap-3">
      <section className="cisne-divider pb-2.5" aria-labelledby="ops-identity-heading">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <h3 id="ops-identity-heading" className="cisne-type-workspace m-0">
            Ordem {order.orderNumber}
          </h3>
          <ServiceOrderStatusBadge status={order.status} />
        </div>
        <p className="cisne-type-helper m-0">
          Atualizada em <DateTime value={order.updatedAt} mode="date" />
          {order.deadlineAt ? (
            <>
              {' · Prazo operacional '}
              <DateTime value={order.deadlineAt} mode="date" />
            </>
          ) : (
            ' · sem prazo operacional publicado'
          )}
        </p>
      </section>

      {/*
        CLIENTE E CONTRATO — o contexto de quem a ordem atende.
        O que o servidor publica e o que aparece; o que ele nao publica nao vira linha vazia nem
        rotulo inventado.
      */}
      <section className="cisne-divider pb-2.5" aria-labelledby="ops-client-heading">
        <h3 id="ops-client-heading" className="cisne-meta-label m-0 mb-1">
          Cliente e local
        </h3>
        <dl className="m-0 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="cisne-type-helper">Cliente</dt>
          <dd className="cisne-type-body m-0">
            {client ? (
              order.clientId ? (
                <Link
                  to={`/app/clients/${order.clientId}`}
                  className="font-semibold text-brand-700 no-underline hover:underline"
                >
                  {client}
                </Link>
              ) : (
                client
              )
            ) : order.clientId ? (
              <Link
                to={`/app/clients/${order.clientId}`}
                className="text-brand-700 no-underline hover:underline"
              >
                Abrir cliente no cadastro
              </Link>
            ) : (
              <span className="text-gray-500">Sem cliente vinculado a esta ordem</span>
            )}
          </dd>

          {location ? (
            <>
              <dt className="cisne-type-helper">Local</dt>
              <dd className="cisne-type-body m-0">{location}</dd>
            </>
          ) : null}

          <dt className="cisne-type-helper">Unidade</dt>
          <dd className="cisne-type-body m-0">
            {order.unitId && !isTechnicalIdentity(order.unitId)
              ? order.unitId
              : 'Unidade definida no escopo da ordem'}
          </dd>

          <dt className="cisne-type-helper">Responsável</dt>
          <dd className="cisne-type-body m-0">
            {order.assignedWorkforceMember ? (
              order.assignedWorkforceMember.displayName
            ) : (
              <span className="text-gray-500">Sem responsável atribuído</span>
            )}
          </dd>
        </dl>
      </section>

      {order.description ? (
        <section className="cisne-divider pb-2.5" aria-label="Descrição da ordem">
          <h3 className="cisne-meta-label m-0 mb-1">Descrição</h3>
          <p className="cisne-type-body m-0">{order.description}</p>
        </section>
      ) : null}

      {/*
        CADEIA DE NEGOCIO — a leitura de linhagem do proprio objeto.
        `BusinessChain` (business-chain) e o primitivo que le `GET /business-chain` para QUALQUER
        objeto ancorado, com estados de negacao/erro/ausencia proprios. Ele NAO depende do dashboard:
        a cadeia da ordem e do dominio da ordem, nao da composicao do painel.
      */}
      <section aria-label="Cadeia de negócio da ordem" className="cisne-divider pb-2.5">
        <BusinessChain
          chain={chain}
          phase={phase}
          message={message}
          onRetry={retry}
          title="Cadeia de negócio"
        />
      </section>

      {/* A cadeia COMPLETA permanece na object page — aqui fica o contexto, nao o dossie. */}
      <section aria-label="Ações da ordem" className="cisne-divider pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/app/service-orders/${order.id}/execution`}
            className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md bg-cisne-action px-2.5 text-white no-underline hover:bg-cisne-action-hover"
          >
            Abrir execução
          </Link>
          <Link
            to={`/app/service-orders/${order.id}`}
            className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 no-underline hover:bg-gray-100 hover:text-gray-900"
          >
            Abrir ordem completa
          </Link>
          {order.clientId ? (
            <Link
              to={`/app/clients/${order.clientId}`}
              className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 no-underline hover:bg-gray-100 hover:text-gray-900"
            >
              Abrir cliente
            </Link>
          ) : null}
        </div>
        <p className="cisne-type-helper m-0 mt-1">
          Estado {formatServiceOrderStatus(order.status)} · a transição de estado continua no domínio
          responsável; a fila não executa transição sensível.
        </p>
      </section>

      {/* Cadeia completa (relações do objeto) — o mesmo primitivo da object page, sem duplicar dado. */}
    </div>
  );
}
