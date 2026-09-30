import { useEffect, useState } from 'react';
import { AuthzApiError, probeRequest } from '../auth/api/authz-api';
import { probeClientListAccess } from '../clients/api/clients-api';
import { probeCatalogListAccess } from '../catalog/api/service-catalog-api';
import { probeAssetListAccess } from '../assets/api/physical-assets-api';
import { probeServiceRequestListAccess } from '../requests/api/service-requests-api';
import { probeProposalListAccess } from '../proposals/api/proposals-api';
import { probeContractCapabilities } from '../contracts/api/contracts-api';
import { probeSupplierListAccess } from '../suppliers/api/suppliers-api';
import { probePurchaseOrderListAccess } from '../purchase-orders/api/purchase-orders-api';
import { probeBillingCapabilities } from '../billing/api/billing-api';
import { probeDocumentCapabilities } from '../documents/api/documents-api';
import { probeServiceOrderListAccess } from '../service-orders/api/service-orders-api';
import { probePersonListAccess } from '../people/api/people-api';
import {
  probePayableListAccess,
  probeReceivableListAccess,
  probeReconciliationReadAccess,
  probeTreasuryListAccess,
  probeExpenseReadAccess,
  probeBudgetReadAccess,
  probeForecastReadAccess,
} from '../finance/api/finance-api';
import {
  probeFiscalDocumentReadAccess,
  probeFiscalPeriodReadAccess,
  probeTaxReadAccess,
} from '../fiscal/api/fiscal-api';
import { probeAccountingReadAccess, probeFixedAssetReadAccess } from '../accounting/api/accounting-api';
import { probeProcurementReadAccess } from '../procurement/api/procurement-api';
import { probeInventoryReadAccess } from '../inventory/api/inventory-api';
import { probePayrollReadAccess } from '../payroll/api/payroll-api';
import { probeAccessAdminAccess } from '../access-admin/api/access-admin-api';
import { useAuth } from '../auth/context/AuthProvider';
import { isReleaseModuleEnabled } from '../release-scope/feature-flags';
import { SHELL_NAV_ITEMS } from './nav-config';
import { hasEntryRead, probeSurfaceAccess, resolveAuthorizedUnit, SURFACE_ACCESS_CONTRACT_VERSION } from './surface-access';
import type { NavAccessMap } from './types';

type NavAccessState = {
  loading: boolean;
  access: NavAccessMap;
};

const INITIAL_ACCESS: NavAccessMap = Object.fromEntries(
  SHELL_NAV_ITEMS.map((item) => [item.id, item.accessCheck ? false : true]),
);

/**
 * CACHE DO MAPA DE ACESSO DA NAVEGACAO — em memoria E em `sessionStorage`.
 *
 * O PROBLEMA MEDIDO. Abrir qualquer rota disparava a bateria INTEIRA de sondas
 * (11 requisicoes de autorizacao) DUAS vezes — uma pela lista lateral (`ShellNavList`) e
 * outra pelo host da paleta de comandos (`AppShellLayout`). Medido no HML real: **22
 * requisicoes por carga de documento**, em todas as 58 rotas, inclusive nas que o operador
 * nao tem nada a ver. Cada sonda de leitura usa um id-sonda inexistente de proposito, entao
 * o servidor responde 404 e classifica a tentativa como negacao em
 * `authorization.decision_audits`. O efeito pratico: um operador navegando por URLs
 * coladas (o caso comum de quem recebe um link) produzia ~22 auditorias de negacao por
 * pagina, e o volume empurrava a propria sessao contra o limite de requisicoes da API.
 *
 * A CORRECAO, em duas partes:
 *   1. MEMORIA — as duas superficies do shell compartilham UMA resolucao por render.
 *   2. SESSAO — o resultado sobrevive ao proximo documento (`sessionStorage`), que e o que
 *      elimina o custo por rota. Sem isso, melhorar a duplicacao nao mudava nada visivel.
 *
 * A CHAVE E A IDENTIDADE AUTENTICADA. O mapa responde "o que ESTE ator pode abrir"; guardar
 * por sessao sem identidade faria um ator herdar o menu de outro apos a troca de login. O
 * `sessionStorage` ja e limpo no logout (`tokenStore.clear`), e aqui a entrada e descartada
 * quando a identidade nao confere — nunca ha reuso cruzado entre atores.
 *
 * O QUE ISTO NAO E: nao e fronteira de seguranca e nao amplia permissao. E cache de
 * APRESENTACAO do menu. A decisao real continua no servidor, por requisicao
 * (`AuthorizationGuard` + PDP). Um ator sem grant que alcance a URL recebe 403 do backend
 * com ou sem cache — e o pior caso deste cache e um item de menu a mais que leva a uma
 * negacao correta, o mesmo estado que existia antes de ele ser resolvido.
 *
 * A CHAVE DE VALIDADE NAO E SO A IDENTIDADE — E A REVISAO DO CONTRATO. Um mapa guardado
 * responde "o que o ator podia abrir quando ele foi calculado", e sobrevive a reload na mesma
 * aba. Guardar por identidade apenas fazia toda correcao de sonda chegar INVISIVEL a quem ja
 * tinha o mapa: o codigo novo entrava, o navegador servia o veredito antigo, e o defeito
 * aparecia de novo na tela. `SURFACE_ACCESS_CONTRACT_VERSION` (surface-access.ts) e a
 * assinatura do contrato que produziu o mapa; revisao diferente = mapa descartado.
 */
const NAV_ACCESS_STORAGE_KEY = 'cisne.navAccess.v1';

let navAccessCache: { identityId: string; state: NavAccessState } | null = null;

function readPersistedNavAccess(identityId: string): NavAccessState | null {
  try {
    const raw = window.sessionStorage.getItem(NAV_ACCESS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as {
      identityId?: unknown;
      contractVersion?: unknown;
      access?: unknown;
    };
    // Identidade diferente = cache de OUTRO ator. Descartar, nunca herdar.
    if (parsed.identityId !== identityId || typeof parsed.access !== 'object' || !parsed.access) {
      return null;
    }
    /**
     * Contrato diferente (ou ausente, como em todo mapa gravado antes desta revisao) = veredito
     * de outra regra. Descartar e perguntar ao servidor de novo. Sem isto, uma correcao de sonda
     * nao alcanca quem ja navegou: o menu continua mostrando a porta que a pagina nao abre.
     */
    if (parsed.contractVersion !== SURFACE_ACCESS_CONTRACT_VERSION) {
      return null;
    }
    return { loading: false, access: parsed.access as NavAccessMap };
  } catch {
    return null;
  }
}

function persistNavAccess(identityId: string, state: NavAccessState): void {
  try {
    window.sessionStorage.setItem(
      NAV_ACCESS_STORAGE_KEY,
      JSON.stringify({
        identityId,
        contractVersion: SURFACE_ACCESS_CONTRACT_VERSION,
        access: state.access,
      }),
    );
  } catch {
    // Fail-open apenas para o cache: sem persistencia o menu ainda resolve pela rede.
  }
}

/** Test-only reset for isolated unit tests. */
export function resetNavAccessCacheForTests(): void {
  navAccessCache = null;
  try {
    window.sessionStorage.removeItem(NAV_ACCESS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function useNavAccess(): NavAccessState {
  const { status, identityId } = useAuth();
  const [state, setState] = useState<NavAccessState>({
    loading: true,
    access: INITIAL_ACCESS,
  });

  useEffect(() => {
    if (status !== 'authenticated' || !identityId) {
      setState({ loading: false, access: INITIAL_ACCESS });
      return;
    }

    const inMemory = navAccessCache;
    if (inMemory && inMemory.identityId === identityId) {
      setState(inMemory.state);
      return;
    }

    const persisted = readPersistedNavAccess(identityId);
    if (persisted) {
      navAccessCache = { identityId, state: persisted };
      setState(persisted);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    // Capturado uma vez: o cache e indexado pela identidade que originou esta resolucao.
    const ownerIdentityId = identityId;

    async function resolveAccess() {
      const nextAccess: NavAccessMap = { ...INITIAL_ACCESS };

      /**
       * ESCOPO AUTORIZADO resolvido UMA vez para todas as sondas que exigem unidade.
       * Sem ele, fiscal e contabilidade não têm como montar a leitura de entrada.
       */
      const unitId = await resolveAuthorizedUnit(ownerIdentityId, controller.signal);
      if (cancelled) {
        return;
      }

      for (const item of SHELL_NAV_ITEMS) {
        if (item.featureFlag && !isReleaseModuleEnabled(item.featureFlag)) {
          nextAccess[item.id] = false;
          continue;
        }

        if (!item.accessCheck) {
          nextAccess[item.id] = true;
          continue;
        }

        /**
         * CONTRATO ÚNICO (ver `surface-access.ts`).
         *
         * A visibilidade passa a depender da MESMA operação de leitura que a PÁGINA executa
         * para entrar no módulo. Antes, o menu sondava um DETALHE com UUID sintético e lia 404
         * como autorização, enquanto a página pedia a LISTA e recebia 403 — o menu mostrava
         * Orçamentos e Despesas e a página negava.
         *
         * `undetermined` (superfície sem leitura própria, ou sem unidade autorizada) cai na
         * sonda de capability abaixo — que nesses casos é exatamente a MESMA que a página usa,
         * então menu e página seguem concordando.
         */
        if (hasEntryRead(item.accessCheck)) {
          try {
            const result = await probeSurfaceAccess(
              item.accessCheck,
              unitId,
              controller.signal,
            );
            if (result.outcome === 'allowed') {
              nextAccess[item.id] = true;
              continue;
            }
            if (result.outcome === 'denied') {
              nextAccess[item.id] = false;
              continue;
            }
          } catch {
            // Falha de rede na sonda não autoriza: fail-closed.
            nextAccess[item.id] = false;
            continue;
          }
        }

        if (item.accessCheck === 'authz-probe') {
          try {
            await probeRequest(controller.signal);
            nextAccess[item.id] = true;
          } catch (error) {
            if (error instanceof AuthzApiError && error.status === 403) {
              nextAccess[item.id] = false;
              continue;
            }
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'client-list') {
          try {
            const allowed = await probeClientListAccess(controller.signal);
            nextAccess[item.id] = allowed;
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'catalog-list') {
          try {
            const allowed = await probeCatalogListAccess(controller.signal);
            nextAccess[item.id] = allowed;
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'asset-list') {
          try {
            const allowed = await probeAssetListAccess(controller.signal);
            nextAccess[item.id] = allowed;
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'request-list') {
          try {
            const allowed = await probeServiceRequestListAccess(controller.signal);
            nextAccess[item.id] = allowed;
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'proposal-list') {
          try {
            const allowed = await probeProposalListAccess(controller.signal);
            nextAccess[item.id] = allowed;
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'purchase-order-list') {
          try {
            const allowed = await probePurchaseOrderListAccess(controller.signal);
            nextAccess[item.id] = allowed;
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'document-list') {
          try {
            const capabilities = await probeDocumentCapabilities(controller.signal);
            nextAccess[item.id] = capabilities.canList;
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'billing-list') {
          try {
            const capabilities = await probeBillingCapabilities(controller.signal);
            nextAccess[item.id] = capabilities.canRead;
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'service-order-list') {
          try {
            const allowed = await probeServiceOrderListAccess(controller.signal);
            nextAccess[item.id] = allowed;
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'people-list') {
          try {
            const allowed = await probePersonListAccess(controller.signal);
            nextAccess[item.id] = allowed;
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'finance-overview') {
          try {
            const [receivables, payables, treasury] = await Promise.all([
              probeReceivableListAccess(controller.signal),
              probePayableListAccess(controller.signal),
              probeTreasuryListAccess(controller.signal),
            ]);
            nextAccess[item.id] = receivables || payables || treasury;
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'finance-receivable-list') {
          try {
            nextAccess[item.id] = await probeReceivableListAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'finance-payable-list') {
          try {
            nextAccess[item.id] = await probePayableListAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'finance-treasury-list') {
          try {
            nextAccess[item.id] = await probeTreasuryListAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'finance-reconciliation-read') {
          try {
            nextAccess[item.id] = await probeReconciliationReadAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'finance-expense-read') {
          try {
            nextAccess[item.id] = await probeExpenseReadAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'finance-budget-read') {
          try {
            nextAccess[item.id] = await probeBudgetReadAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'finance-forecast-read') {
          try {
            nextAccess[item.id] = await probeForecastReadAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'fiscal-document-read') {
          try {
            nextAccess[item.id] = await probeFiscalDocumentReadAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'fiscal-tax-read') {
          try {
            nextAccess[item.id] = await probeTaxReadAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'fiscal-period-read') {
          try {
            nextAccess[item.id] = await probeFiscalPeriodReadAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'accounting-journal-read') {
          try {
            nextAccess[item.id] = await probeAccountingReadAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'accounting-fixed-asset-read') {
          try {
            nextAccess[item.id] = await probeFixedAssetReadAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'inventory-read') {
          try {
            nextAccess[item.id] = await probeInventoryReadAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'payroll-read') {
          try {
            nextAccess[item.id] = await probePayrollReadAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'procurement-read') {
          try {
            nextAccess[item.id] = await probeProcurementReadAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'supplier-read') {
          // Fornecedores deixaram de ser WIP: a rota existe e o backend responde com
          // capacidade real (`supplier:supplier:list`). A sonda decide a visibilidade; sem
          // concessao o item nao aparece e a rota continua negando no servidor.
          try {
            nextAccess[item.id] = await probeSupplierListAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'contract-list') {
          try {
            const capabilities = await probeContractCapabilities(controller.signal);
            nextAccess[item.id] = capabilities.canList;
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
          continue;
        }

        if (item.accessCheck === 'access-admin') {
          try {
            nextAccess[item.id] = await probeAccessAdminAccess(controller.signal);
          } catch {
            if (!cancelled) {
              nextAccess[item.id] = false;
            }
          }
        }
      }

      if (!cancelled) {
        const resolved: NavAccessState = { loading: false, access: nextAccess };
        navAccessCache = { identityId: ownerIdentityId, state: resolved };
        persistNavAccess(ownerIdentityId, resolved);
        setState(resolved);
      }
    }

    void resolveAccess();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [status, identityId]);

  return state;
}

export function isNavItemVisible(itemId: string, access: NavAccessMap, loading: boolean): boolean {
  const item = SHELL_NAV_ITEMS.find((entry) => entry.id === itemId);
  if (!item) {
    return false;
  }
  if (item.featureFlag && !isReleaseModuleEnabled(item.featureFlag)) {
    return false;
  }
  if (!item.accessCheck) {
    return true;
  }
  if (loading) {
    return false;
  }
  return access[itemId] === true;
}
