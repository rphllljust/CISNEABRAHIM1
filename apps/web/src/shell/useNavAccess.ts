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
import type { NavAccessMap } from './types';

type NavAccessState = {
  loading: boolean;
  access: NavAccessMap;
};

const INITIAL_ACCESS: NavAccessMap = Object.fromEntries(
  SHELL_NAV_ITEMS.map((item) => [item.id, item.accessCheck ? false : true]),
);

export function useNavAccess(): NavAccessState {
  const { status } = useAuth();
  const [state, setState] = useState<NavAccessState>({
    loading: true,
    access: INITIAL_ACCESS,
  });

  useEffect(() => {
    if (status !== 'authenticated') {
      setState({ loading: false, access: INITIAL_ACCESS });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    async function resolveAccess() {
      const nextAccess: NavAccessMap = { ...INITIAL_ACCESS };

      for (const item of SHELL_NAV_ITEMS) {
        if (item.featureFlag && !isReleaseModuleEnabled(item.featureFlag)) {
          nextAccess[item.id] = false;
          continue;
        }

        if (!item.accessCheck) {
          nextAccess[item.id] = true;
          continue;
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
        setState({ loading: false, access: nextAccess });
      }
    }

    void resolveAccess();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [status]);

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
