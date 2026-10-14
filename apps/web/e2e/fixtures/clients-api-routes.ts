import type { Route } from '@playwright/test';
import { CLIENTS_LIST_VISUAL_SNAPSHOT } from './clients-snapshots';
import type { ClientSummary } from '../../src/clients/types/client.types';

type JsonResponse = {
  status: number;
  contentType: string;
  body: string;
};

function jsonBody(body: unknown, status = 200): JsonResponse {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill(jsonBody(body, status));
}

function hasBearerToken(route: Route): boolean {
  return route.request().headers().authorization?.startsWith('Bearer ') ?? false;
}

/**
 * Filtro mínimo sobre o snapshot, na mesma semântica do backend: termo só de dígitos casa prefixo
 * de documento; qualquer outro termo casa razão social ou nome fantasia. É o necessário para que o
 * estado "sem resultado" seja produzido por uma busca REAL, e não por um fixture que finge.
 */
function filterClients(items: ClientSummary[], searchParams: URLSearchParams): ClientSummary[] {
  const q = searchParams.get('q')?.trim() ?? '';
  const status = searchParams.get('status');

  let filtered = items;
  if (status === 'ACTIVE' || status === 'INACTIVE') {
    filtered = filtered.filter((client) => client.status === status);
  }
  if (q.length > 0) {
    const digits = q.replace(/\D/g, '');
    const isDocumentOnly = /^[\d.\-/\s]+$/.test(q);
    const lowered = q.toLowerCase();
    filtered = filtered.filter((client) => {
      if (isDocumentOnly && digits.length >= 2) {
        return client.taxId.startsWith(digits);
      }
      return (
        client.legalName.toLowerCase().includes(lowered) ||
        (client.tradeName ?? '').toLowerCase().includes(lowered)
      );
    });
  }
  return filtered;
}

/**
 * Tráfego determinístico da listagem de Clientes para a validação visual focada.
 *
 * Fixture PRÓPRIA, e não o perfil `commercial`: o snapshot comercial alimenta baselines já
 * commitados de propostas e pedidos de compra, e alterá-lo colocaria essas baselines em risco sem
 * que a regressão visual completa fosse executada. Aqui só a listagem de Clientes é servida, com
 * várias linhas para exercitar de fato a tabela, a barra de filtros e a faixa de paginação.
 *
 * Devolve `false` quando a rota não pertence a esta fixture.
 */
export async function handleClientsApiRoute(route: Route): Promise<boolean> {
  const request = route.request();
  const { pathname, searchParams } = new URL(request.url());
  const method = request.method();

  if (!pathname.startsWith('/api/v1/clients')) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { error: { code: 'CLIENT_DENIED', message: 'Unauthorized.' } }, 401);
    return true;
  }

  if (pathname === '/api/v1/clients' && method === 'GET') {
    const limit = Number(searchParams.get('limit') ?? '20');
    const offset = Number(searchParams.get('offset') ?? '0');
    const items = filterClients(CLIENTS_LIST_VISUAL_SNAPSHOT.items, searchParams);
    const total = items.length;

    await fulfillJson(route, {
      items: items.slice(offset, offset + limit),
      limit,
      offset,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    });
    return true;
  }

  /*
   * DETALHE E CONTEXTO DO REGISTRO — as rotas que a COLUNA DE CONTEXTO consome.
   *
   * Sem elas o catch-all devolvia 404 e a coluna abria com "não foi possível carregar", o que
   * tornava a evidência visual inútil: a captura mostraria uma tela de erro em vez da composição
   * real. O fixture serve o contrato COMPLETO do Cliente selecionado — identidade, contatos,
   * unidades e endereços —, e responde qualidade e financeiro com o mesmo formato do servidor.
   */
  const detailMatch = pathname.match(/^\/api\/v1\/clients\/([0-9a-f-]{36})(\/.*)?$/i);
  if (detailMatch && method === 'GET') {
    const clientId = detailMatch[1]!;
    const sub = detailMatch[2] ?? '';
    const summary = CLIENTS_LIST_VISUAL_SNAPSHOT.items.find((item) => item.id === clientId);

    if (sub === '/data-quality') {
      await fulfillJson(route, {
        evaluated: true,
        isComplete: false,
        findings: [
          {
            code: 'MISSING_BILLING_CONTACT',
            severity: 'attention',
            summary: 'Sem contato de faturamento.',
            consequence: 'A cobrança não tem destinatário declarado no cadastro do Cliente.',
          },
        ],
      });
      return true;
    }

    /*
     * FINANCEIRO AUTORIZADO E VAZIO — o estado em que o servidor CONSULTOU e não há título. É o
     * desfecho que prova a distinção entre "sem títulos" e "não autorizado": a coluna deve dizer
     * "Nenhum título a receber", e nunca "R$ 0,00".
     */
    if (sub === '/financial-context') {
      await fulfillJson(route, {
        evaluated: true,
        authorized: true,
        currencies: [],
        asOf: new Date().toISOString(),
      });
      return true;
    }

    if (sub === '/hierarchy') {
      await fulfillJson(route, {
        rootId: clientId,
        nodes: [
          {
            id: clientId,
            legal_name: summary?.legalName ?? 'Cliente',
            trade_name: summary?.tradeName ?? null,
            status: summary?.status ?? 'ACTIVE',
            parent_client_id: summary?.parentClientId ?? null,
            group_id: summary?.groupId ?? null,
            group_name: summary?.groupName ?? null,
            child_count: summary?.childCount ?? 0,
            depth: 0,
            relation: 'self',
          },
        ],
        truncated: false,
        maxDepth: 8,
      });
      return true;
    }

    if (sub === '/audit-trail') {
      await fulfillJson(route, { items: [], limit: 20, offset: 0, total: 0, totalPages: 0 });
      return true;
    }

    if (sub === '') {
      await fulfillJson(route, {
        ...(summary ?? {}),
        externalErpId: null,
        deactivatedAt: null,
        deactivationReason: null,
        purchaseOrderRequirement: 'NOT_REQUIRED',
        contacts: [
          {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
            name: 'Operações Alfa',
            purpose: 'operational',
            role: 'operational',
            isPrimary: true,
            deactivatedAt: null,
            email: 'ops@alfa.invalid',
            phone: '6533330001',
          },
          {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
            name: 'Compras Alfa',
            purpose: 'commercial',
            role: 'purchasing',
            isPrimary: false,
            deactivatedAt: null,
            email: 'compras@alfa.invalid',
            phone: null,
          },
        ],
        addresses: [
          {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
            purpose: 'billing',
            unitId: null,
            unitName: 'Matriz Cuiabá',
            street: 'Av. Historiador Rubens de Mendonça',
            number: '1000',
            complement: null,
            district: 'Centro',
            city: 'Cuiabá',
            state: 'MT',
            postalCode: '78000-000',
            country: 'Brasil',
          },
        ],
        units: [
          {
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
            name: 'Matriz Cuiabá',
            isHeadquarters: true,
            city: 'Cuiabá',
            state: 'MT',
            addressCount: 1,
          },
        ],
      });
      return true;
    }
  }

  // Sondas de capability do módulo: 404 (e não 403) é o que faz o probe concluir que a capability
  // existe, mantendo visíveis as ações autorizadas — "Novo Cliente" e as linhas navegáveis.
  await fulfillJson(route, { error: { code: 'CLIENT_NOT_FOUND', message: 'Not found.' } }, 404);
  return true;
}
