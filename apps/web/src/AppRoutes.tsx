import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoadingState } from './ui/LoadingState';
import { ProtectedRoute } from './auth/components/ProtectedRoute';
import { CapabilityRoute } from './shell/CapabilityRoute';
import { AppShellLayout } from './shell/AppShellLayout';
import { ClientsRoute } from './clients/ClientsRoute';
import { PeopleRoute } from './people/PeopleRoute';
import { CatalogRoute } from './catalog/CatalogRoute';
import { BillingRoute } from './billing/BillingRoute';
import { AssetsRoute } from './assets/AssetsRoute';
import { RequestsRoute } from './requests/RequestsRoute';
import { ServiceOrdersRoute } from './service-orders/ServiceOrdersRoute';
import { ExecutionShellLayout } from './service-orders/layout/ExecutionShellLayout';
import { ProposalsRoute } from './proposals/ProposalsRoute';
import { PurchaseOrdersRoute } from './purchase-orders/PurchaseOrdersRoute';
import { ContractsRoute } from './contracts/ContractsRoute';
import { FinanceRoute } from './finance/FinanceRoute';
import { FiscalRoute } from './fiscal/FiscalRoute';
import { AccountingRoute } from './accounting/AccountingRoute';
import { AccessAdminRoute } from './access-admin/AccessAdminRoute';

const ClientCreatePage = lazy(() => import('./clients/pages/ClientCreatePage').then((module) => ({ default: module.ClientCreatePage })));
const ClientDetailPage = lazy(() => import('./clients/pages/ClientDetailPage').then((module) => ({ default: module.ClientDetailPage })));
const ClientEditPage = lazy(() => import('./clients/pages/ClientEditPage').then((module) => ({ default: module.ClientEditPage })));
const ClientsListPage = lazy(() => import('./clients/pages/ClientsListPage').then((module) => ({ default: module.ClientsListPage })));
const PeopleListPage = lazy(() => import('./people/pages/PeopleListPage').then((module) => ({ default: module.PeopleListPage })));
const PersonCreatePage = lazy(() => import('./people/pages/PersonCreatePage').then((module) => ({ default: module.PersonCreatePage })));
const PersonDetailPage = lazy(() => import('./people/pages/PersonDetailPage').then((module) => ({ default: module.PersonDetailPage })));
const PersonEditPage = lazy(() => import('./people/pages/PersonEditPage').then((module) => ({ default: module.PersonEditPage })));
const ServiceDefinitionComparePage = lazy(() => import('./catalog/pages/ServiceDefinitionComparePage').then((module) => ({ default: module.ServiceDefinitionComparePage })));
const ServiceDefinitionCreatePage = lazy(() => import('./catalog/pages/ServiceDefinitionCreatePage').then((module) => ({ default: module.ServiceDefinitionCreatePage })));
const ServiceDefinitionDetailPage = lazy(() => import('./catalog/pages/ServiceDefinitionDetailPage').then((module) => ({ default: module.ServiceDefinitionDetailPage })));
const ServiceDefinitionDraftEditPage = lazy(() => import('./catalog/pages/ServiceDefinitionDraftEditPage').then((module) => ({ default: module.ServiceDefinitionDraftEditPage })));
const ServiceDefinitionVersionCreatePage = lazy(() => import('./catalog/pages/ServiceDefinitionVersionCreatePage').then((module) => ({ default: module.ServiceDefinitionVersionCreatePage })));
const ServiceDefinitionVersionDetailPage = lazy(() => import('./catalog/pages/ServiceDefinitionVersionDetailPage').then((module) => ({ default: module.ServiceDefinitionVersionDetailPage })));
const ServiceDefinitionsListPage = lazy(() => import('./catalog/pages/ServiceDefinitionsListPage').then((module) => ({ default: module.ServiceDefinitionsListPage })));
const DocumentsPage = lazy(() => import('./documents/pages/DocumentsPage').then((module) => ({ default: module.DocumentsPage })));
const BillingDashboardPage = lazy(() => import('./billing/pages/BillingDashboardPage').then((module) => ({ default: module.BillingDashboardPage })));
const ServiceOrderBillingDocumentPage = lazy(() => import('./billing/pages/ServiceOrderBillingDocumentPage').then((module) => ({ default: module.ServiceOrderBillingDocumentPage })));
const ServiceOrderBillingPage = lazy(() => import('./billing/pages/ServiceOrderBillingPage').then((module) => ({ default: module.ServiceOrderBillingPage })));
const AccessDeniedPage = lazy(() => import('./pages/AccessDeniedPage').then((module) => ({ default: module.AccessDeniedPage })));
const PhysicalAssetCreatePage = lazy(() => import('./assets/pages/PhysicalAssetCreatePage').then((module) => ({ default: module.PhysicalAssetCreatePage })));
const PhysicalAssetDetailPage = lazy(() => import('./assets/pages/PhysicalAssetDetailPage').then((module) => ({ default: module.PhysicalAssetDetailPage })));
const PhysicalAssetEditPage = lazy(() => import('./assets/pages/PhysicalAssetEditPage').then((module) => ({ default: module.PhysicalAssetEditPage })));
const PhysicalAssetsListPage = lazy(() => import('./assets/pages/PhysicalAssetsListPage').then((module) => ({ default: module.PhysicalAssetsListPage })));
const FleetListPage = lazy(() => import('./fleet/pages/FleetListPage').then((module) => ({ default: module.FleetListPage })));
const RentalsListPage = lazy(() => import('./rentals/pages/RentalsListPage').then((module) => ({ default: module.RentalsListPage })));
const TransportListPage = lazy(() => import('./transport/pages/TransportListPage').then((module) => ({ default: module.TransportListPage })));
const ServiceOrderPlanningPage = lazy(() => import('./service-orders/pages/ServiceOrderPlanningPage').then((module) => ({ default: module.ServiceOrderPlanningPage })));
const ServiceOrdersEngineListPage = lazy(() => import('./service-orders/pages/ServiceOrdersEngineListPage').then((module) => ({ default: module.ServiceOrdersEngineListPage })));
const ServiceOrderExecutionPage = lazy(() => import('./service-orders/pages/ServiceOrderExecutionPage').then((module) => ({ default: module.ServiceOrderExecutionPage })));
const ServiceOrderMeasurementPage = lazy(() => import('./service-orders/pages/ServiceOrderMeasurementPage').then((module) => ({ default: module.ServiceOrderMeasurementPage })));
const MeasurementWorkbenchPage = lazy(() => import('./service-orders/pages/MeasurementWorkbenchPage').then((module) => ({ default: module.MeasurementWorkbenchPage })));
const RevenueLeakagePage = lazy(() => import('./service-orders/pages/RevenueLeakagePage').then((module) => ({ default: module.RevenueLeakagePage })));
const ServiceOrderCreatePage = lazy(() => import('./service-orders/pages/ServiceOrderCreatePage').then((module) => ({ default: module.ServiceOrderCreatePage })));
const ServiceRequestCreatePage = lazy(() => import('./requests/pages/ServiceRequestCreatePage').then((module) => ({ default: module.ServiceRequestCreatePage })));
const ServiceRequestDetailPage = lazy(() => import('./requests/pages/ServiceRequestDetailPage').then((module) => ({ default: module.ServiceRequestDetailPage })));
const ServiceRequestEditPage = lazy(() => import('./requests/pages/ServiceRequestEditPage').then((module) => ({ default: module.ServiceRequestEditPage })));
const ServiceRequestsListPage = lazy(() => import('./requests/pages/ServiceRequestsListPage').then((module) => ({ default: module.ServiceRequestsListPage })));
const ProposalsListPage = lazy(() => import('./proposals/pages/ProposalsListPage').then((module) => ({ default: module.ProposalsListPage })));
const ProposalCreatePage = lazy(() => import('./proposals/pages/ProposalCreatePage').then((module) => ({ default: module.ProposalCreatePage })));
const ProposalDetailPage = lazy(() => import('./proposals/pages/ProposalDetailPage').then((module) => ({ default: module.ProposalDetailPage })));
const ProposalEditPage = lazy(() => import('./proposals/pages/ProposalEditPage').then((module) => ({ default: module.ProposalEditPage })));
const PurchaseOrdersListPage = lazy(() => import('./purchase-orders/pages/PurchaseOrdersListPage').then((module) => ({ default: module.PurchaseOrdersListPage })));
const PurchaseOrderCreatePage = lazy(() => import('./purchase-orders/pages/PurchaseOrderCreatePage').then((module) => ({ default: module.PurchaseOrderCreatePage })));
const PurchaseOrderDetailPage = lazy(() => import('./purchase-orders/pages/PurchaseOrderDetailPage').then((module) => ({ default: module.PurchaseOrderDetailPage })));
const PurchaseOrderEditPage = lazy(() => import('./purchase-orders/pages/PurchaseOrderEditPage').then((module) => ({ default: module.PurchaseOrderEditPage })));
const ContractsListPage = lazy(() => import('./contracts/pages/ContractsListPage').then((module) => ({ default: module.ContractsListPage })));
const ContractsCreatePage = lazy(() => import('./contracts/pages/ContractsCreatePage').then((module) => ({ default: module.ContractsCreatePage })));
const ContractsDetailPage = lazy(() => import('./contracts/pages/ContractsDetailPage').then((module) => ({ default: module.ContractsDetailPage })));
const OperationalDashboardPage = lazy(() => import('./dashboard/pages/OperationalDashboardPage').then((module) => ({ default: module.OperationalDashboardPage })));
const AlertCenterPage = lazy(() => import('./alerts/pages/AlertCenterPage').then((module) => ({ default: module.AlertCenterPage })));
const MyInboxPage = lazy(() => import('./work-inbox/pages/MyInboxPage').then((module) => ({ default: module.MyInboxPage })));
const OperationsDispatchWorkspacePage = lazy(() => import('./service-orders/pages/OperationsDispatchWorkspacePage').then((module) => ({ default: module.OperationsDispatchWorkspacePage })));
const SearchResultsPage = lazy(() => import('./search/pages/SearchResultsPage').then((module) => ({ default: module.SearchResultsPage })));
const ReportsPage = lazy(() => import('./reports/pages/ReportsPage').then((module) => ({ default: module.ReportsPage })));
const OperationalProfitabilityPage = lazy(() => import('./analytics/pages/OperationalProfitabilityPage').then((module) => ({ default: module.OperationalProfitabilityPage })));
const ComplianceBiPage = lazy(() => import('./analytics/pages/ComplianceBiPage').then((module) => ({ default: module.ComplianceBiPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const PlatformDiagnosticsPage = lazy(() => import('./pages/PlatformDiagnosticsPage').then((module) => ({ default: module.PlatformDiagnosticsPage })));
const ServiceUnavailablePage = lazy(() => import('./pages/ServiceUnavailablePage').then((module) => ({ default: module.ServiceUnavailablePage })));
const ShellAccessDeniedPage = lazy(() => import('./pages/ShellAccessDeniedPage').then((module) => ({ default: module.ShellAccessDeniedPage })));
const ShellNotFoundPage = lazy(() => import('./pages/ShellNotFoundPage').then((module) => ({ default: module.ShellNotFoundPage })));
const SessionExpiredPage = lazy(() => import('./pages/SessionExpiredPage').then((module) => ({ default: module.SessionExpiredPage })));
const DomainWorkspacePage = lazy(() => import('./workspaces/pages/DomainWorkspacePage').then((module) => ({ default: module.DomainWorkspacePage })));
const WorkspacesIndexPage = lazy(() => import('./workspaces/pages/WorkspacesIndexPage').then((module) => ({ default: module.WorkspacesIndexPage })));
const FinanceOverviewPage = lazy(() => import('./finance/pages/FinanceOverviewPage').then((module) => ({ default: module.FinanceOverviewPage })));
const ReceivablesListPage = lazy(() => import('./finance/pages/ReceivablesListPage').then((module) => ({ default: module.ReceivablesListPage })));
const ReceivableDetailPage = lazy(() => import('./finance/pages/ReceivableDetailPage').then((module) => ({ default: module.ReceivableDetailPage })));
const PayablesListPage = lazy(() => import('./finance/pages/PayablesListPage').then((module) => ({ default: module.PayablesListPage })));
const PayableDetailPage = lazy(() => import('./finance/pages/PayableDetailPage').then((module) => ({ default: module.PayableDetailPage })));
const TreasuryListPage = lazy(() => import('./finance/pages/TreasuryListPage').then((module) => ({ default: module.TreasuryListPage })));
const TreasuryAccountDetailPage = lazy(() => import('./finance/pages/TreasuryAccountDetailPage').then((module) => ({ default: module.TreasuryAccountDetailPage })));
const BankReconciliationPage = lazy(() => import('./finance/pages/BankReconciliationPage').then((module) => ({ default: module.BankReconciliationPage })));
const ExpensesListPage = lazy(() => import('./finance/pages/ExpensesListPage').then((module) => ({ default: module.ExpensesListPage })));
const ExpensesPage = lazy(() => import('./finance/pages/ExpensesPage').then((module) => ({ default: module.ExpensesPage })));
const BudgetsListPage = lazy(() => import('./finance/pages/BudgetsListPage').then((module) => ({ default: module.BudgetsListPage })));
const BudgetsPage = lazy(() => import('./finance/pages/BudgetsPage').then((module) => ({ default: module.BudgetsPage })));
const CashForecastPage = lazy(() => import('./finance/pages/CashForecastPage').then((module) => ({ default: module.CashForecastPage })));
const FiscalDocumentsPage = lazy(() => import('./fiscal/pages/FiscalDocumentsPage').then((module) => ({ default: module.FiscalDocumentsPage })));
const FiscalPeriodsPage = lazy(() => import('./fiscal/pages/FiscalPeriodsPage').then((module) => ({ default: module.FiscalPeriodsPage })));
const TaxAssessmentsPage = lazy(() => import('./fiscal/pages/TaxAssessmentsPage').then((module) => ({ default: module.TaxAssessmentsPage })));
const FiscalApuracaoPage = lazy(() => import('./fiscal/pages/FiscalApuracaoPage').then((module) => ({ default: module.FiscalApuracaoPage })));
const FiscalTributosPage = lazy(() => import('./fiscal/pages/FiscalTributosPage').then((module) => ({ default: module.FiscalTributosPage })));
const ChartOfAccountsPage = lazy(() => import('./accounting/pages/ChartOfAccountsPage').then((module) => ({ default: module.ChartOfAccountsPage })));
const JournalsPage = lazy(() => import('./accounting/pages/JournalsPage').then((module) => ({ default: module.JournalsPage })));
const BalanceSheetPage = lazy(() => import('./accounting/pages/PeriodReportPages').then((module) => ({ default: module.BalanceSheetPage })));
const GeneralLedgerPage = lazy(() => import('./accounting/pages/PeriodReportPages').then((module) => ({ default: module.GeneralLedgerPage })));
const IncomeStatementPage = lazy(() => import('./accounting/pages/PeriodReportPages').then((module) => ({ default: module.IncomeStatementPage })));
const JournalBookPage = lazy(() => import('./accounting/pages/PeriodReportPages').then((module) => ({ default: module.JournalBookPage })));
const TrialBalancePage = lazy(() => import('./accounting/pages/PeriodReportPages').then((module) => ({ default: module.TrialBalancePage })));
const PeriodClosePage = lazy(() => import('./accounting/pages/PeriodClosePage').then((module) => ({ default: module.PeriodClosePage })));
const ClosingCenterPage = lazy(() => import('./accounting/pages/ClosingCenterPage').then((module) => ({ default: module.ClosingCenterPage })));
const AccountingPostingOriginsPage = lazy(() => import('./accounting/pages/AccountingPostingOriginsPage').then((module) => ({ default: module.AccountingPostingOriginsPage })));
const EconomicPostingWorklistPage = lazy(() => import('./accounting/pages/EconomicPostingWorklistPage').then((module) => ({ default: module.EconomicPostingWorklistPage })));
const EconomicTracePage = lazy(() => import('./accounting/pages/EconomicTracePage').then((module) => ({ default: module.EconomicTracePage })));
const FixedAssetsPage = lazy(() => import('./accounting/pages/FixedAssetsPage').then((module) => ({ default: module.FixedAssetsPage })));
const ProcurementRoute = lazy(() => import('./procurement/pages/ProcurementPages').then((module) => ({ default: module.ProcurementRoute })));
const ProcurementHubPage = lazy(() => import('./procurement/pages/ProcurementPages').then((module) => ({ default: module.ProcurementHubPage })));
const PurchaseRequestCreatePage = lazy(() => import('./procurement/pages/ProcurementPages').then((module) => ({ default: module.PurchaseRequestCreatePage })));
const PurchaseRequestPage = lazy(() => import('./procurement/pages/ProcurementPages').then((module) => ({ default: module.PurchaseRequestPage })));
const PurchaseOrderPage = lazy(() => import('./procurement/pages/ProcurementPages').then((module) => ({ default: module.PurchaseOrderPage })));
const SupplierInvoicePage = lazy(() => import('./procurement/pages/ProcurementPages').then((module) => ({ default: module.SupplierInvoicePage })));
const ThreeWayMatchPage = lazy(() => import('./procurement/pages/ProcurementPages').then((module) => ({ default: module.ThreeWayMatchPage })));
const InventoryItemDetailPage = lazy(() => import('./inventory/pages/InventoryPage').then((module) => ({ default: module.InventoryItemDetailPage })));
const InventoryPage = lazy(() => import('./inventory/pages/InventoryPage').then((module) => ({ default: module.InventoryPage })));
const InventoryRoute = lazy(() => import('./inventory/pages/InventoryPage').then((module) => ({ default: module.InventoryRoute })));
const InventoryWarehouseDetailPage = lazy(() => import('./inventory/pages/InventoryPage').then((module) => ({ default: module.InventoryWarehouseDetailPage })));
const PayrollRoute = lazy(() => import('./payroll/pages/PayrollPage').then((module) => ({ default: module.PayrollRoute })));
const PayrollPage = lazy(() => import('./payroll/pages/PayrollPage').then((module) => ({ default: module.PayrollPage })));
const SupplierCreatePage = lazy(() => import('./suppliers/pages/SupplierCreatePage').then((module) => ({ default: module.SupplierCreatePage })));
const SuppliersEngineListPage = lazy(() => import('./suppliers/pages/SuppliersEngineListPage').then((module) => ({ default: module.SuppliersEngineListPage })));
const SuppliersEngineDetailPage = lazy(() => import('./suppliers/pages/SuppliersEngineDetailPage').then((module) => ({ default: module.SuppliersEngineDetailPage })));
const SuppliersRoute = lazy(() => import('./suppliers/pages/SuppliersRoute').then((module) => ({ default: module.SuppliersRoute })));
const AccessAdminPage = lazy(() => import('./access-admin/pages/AccessAdminPage').then((module) => ({ default: module.AccessAdminPage })));
const ServiceOrderEngineDetailPage = lazy(() => import('./service-orders/pages/ServiceOrderEngineDetailPage').then((module) => ({ default: module.ServiceOrderEngineDetailPage })));
const ModulesRegistryPage = lazy(() => import('./modules-registry/ModulesRegistryPage').then((module) => ({ default: module.ModulesRegistryPage })));
const MetadataExplorerPage = lazy(() => import('./admin/MetadataExplorerPage').then((module) => ({ default: module.MetadataExplorerPage })));
const ViewLabPage = lazy(() => import('./admin/ViewLabPage').then((module) => ({ default: module.ViewLabPage })));

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingState label="Carregando módulo…" className="p-4" />}>
      <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/access-denied" element={<AccessDeniedPage />} />
            <Route path="/session-expired" element={<SessionExpiredPage />} />
            <Route path="/unavailable" element={<ServiceUnavailablePage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<ExecutionShellLayout />}>
                <Route
                  path="/app/service-orders/:serviceOrderId/execution"
                  element={
                    <ServiceOrdersRoute>
                      <ServiceOrderExecutionPage />
                    </ServiceOrdersRoute>
                  }
                />
              </Route>
            <Route element={<AppShellLayout />}>
              <Route path="/app" element={<OperationalDashboardPage />} />
              <Route path="/app/alerts" element={<AlertCenterPage />} />
              <Route path="/app/work-inbox" element={<MyInboxPage />} />
              {/*
                WORKSPACES DE DOMINIO — uma superficie de decisao por dominio, sobre a MESMA
                fila de trabalho. O financeiro e o unico que vive fora de `/app/workspaces`
                porque a conversao aconteceu em `/app/finance`: a rota abaixo redireciona para
                la, e nao para uma segunda superficie financeira divergente.
              */}
              <Route path="/app/workspaces" element={<WorkspacesIndexPage />} />
              <Route
                path="/app/workspaces/comercial"
                element={<DomainWorkspacePage domain="COMERCIAL" />}
              />
              <Route
                path="/app/workspaces/operacoes"
                element={<OperationsDispatchWorkspacePage />}
              />
              {/*
                DISPATCH BOARD e EXECUTION CONSOLE — rotas próprias.
                O workspace concentra a estação; estas duas existem para que o
                operador possa manter uma aba aberta só no despacho (ou só na
                execução) durante o turno, em vez de trocar de aba toda hora.
              */}
              <Route
                path="/app/operations/dispatch"
                element={<OperationsDispatchWorkspacePage initialTab="dispatch" />}
              />
              <Route
                path="/app/operations/execution"
                element={<OperationsDispatchWorkspacePage initialTab="execution" />}
              />
              <Route
                path="/app/workspaces/financeiro"
                element={<Navigate to="/app/finance" replace />}
              />
              <Route
                path="/app/workspaces/fiscal"
                element={<DomainWorkspacePage domain="FISCAL" />}
              />
              <Route
                path="/app/workspaces/contabilidade"
                element={<DomainWorkspacePage domain="CONTABILIDADE" />}
              />
              <Route
                path="/app/workspaces/suprimentos"
                element={<DomainWorkspacePage domain="SUPRIMENTOS" />}
              />
              <Route path="/app/search" element={<SearchResultsPage />} />
              <Route path="/app/reports" element={<ReportsPage />} />
              <Route
                path="/app/operational-profitability"
                element={<OperationalProfitabilityPage />}
              />
              <Route path="/app/reports/compliance" element={<ComplianceBiPage />} />
              <Route path="/app/modules" element={<ModulesRegistryPage />} />
              <Route
                path="/app/access-admin"
                element={
                  <AccessAdminRoute>
                    <AccessAdminPage />
                  </AccessAdminRoute>
                }
              />
              <Route
                path="/app/platform"
                element={
                  <CapabilityRoute>
                    <PlatformDiagnosticsPage />
                  </CapabilityRoute>
                }
              />
              <Route
                path="/app/clients"
                element={
                  <ClientsRoute>
                    <ClientsListPage />
                  </ClientsRoute>
                }
              />
              <Route
                path="/app/clients/new"
                element={
                  <ClientsRoute>
                    <ClientCreatePage />
                  </ClientsRoute>
                }
              />
              <Route
                path="/app/clients/:clientId/edit"
                element={
                  <ClientsRoute>
                    <ClientEditPage />
                  </ClientsRoute>
                }
              />
              <Route
                path="/app/clients/:clientId"
                element={
                  <ClientsRoute>
                    <ClientDetailPage />
                  </ClientsRoute>
                }
              />
              <Route
                path="/app/people"
                element={
                  <PeopleRoute>
                    <PeopleListPage />
                  </PeopleRoute>
                }
              />
              <Route
                path="/app/people/new"
                element={
                  <PeopleRoute>
                    <PersonCreatePage />
                  </PeopleRoute>
                }
              />
              <Route
                path="/app/people/:personId/edit"
                element={
                  <PeopleRoute>
                    <PersonEditPage />
                  </PeopleRoute>
                }
              />
              <Route
                path="/app/people/:personId"
                element={
                  <PeopleRoute>
                    <PersonDetailPage />
                  </PeopleRoute>
                }
              />
              <Route
                path="/app/catalog"
                element={
                  <CatalogRoute>
                    <ServiceDefinitionsListPage />
                  </CatalogRoute>
                }
              />
              <Route
                path="/app/catalog/new"
                element={
                  <CatalogRoute>
                    <ServiceDefinitionCreatePage />
                  </CatalogRoute>
                }
              />
              <Route
                path="/app/catalog/:definitionId/compare"
                element={
                  <CatalogRoute>
                    <ServiceDefinitionComparePage />
                  </CatalogRoute>
                }
              />
              <Route
                path="/app/catalog/:definitionId/versions/new"
                element={
                  <CatalogRoute>
                    <ServiceDefinitionVersionCreatePage />
                  </CatalogRoute>
                }
              />
              <Route
                path="/app/catalog/:definitionId/versions/:versionNumber/edit"
                element={
                  <CatalogRoute>
                    <ServiceDefinitionDraftEditPage />
                  </CatalogRoute>
                }
              />
              <Route
                path="/app/catalog/:definitionId/versions/:versionNumber"
                element={
                  <CatalogRoute>
                    <ServiceDefinitionVersionDetailPage />
                  </CatalogRoute>
                }
              />
              <Route
                path="/app/catalog/:definitionId"
                element={
                  <CatalogRoute>
                    <ServiceDefinitionDetailPage />
                  </CatalogRoute>
                }
              />
              <Route
                path="/app/fleet"
                element={
                  <AssetsRoute>
                    <FleetListPage />
                  </AssetsRoute>
                }
              />
              <Route
                path="/app/assets"
                element={
                  <AssetsRoute>
                    <PhysicalAssetsListPage />
                  </AssetsRoute>
                }
              />
              <Route
                path="/app/assets/new"
                element={
                  <AssetsRoute>
                    <PhysicalAssetCreatePage />
                  </AssetsRoute>
                }
              />
              <Route
                path="/app/assets/:assetId/edit"
                element={
                  <AssetsRoute>
                    <PhysicalAssetEditPage />
                  </AssetsRoute>
                }
              />
              <Route
                path="/app/assets/:assetId"
                element={
                  <AssetsRoute>
                    <PhysicalAssetDetailPage />
                  </AssetsRoute>
                }
              />
              <Route
                path="/app/requests"
                element={
                  <RequestsRoute>
                    <ServiceRequestsListPage />
                  </RequestsRoute>
                }
              />
              <Route
                path="/app/requests/new"
                element={
                  <RequestsRoute>
                    <ServiceRequestCreatePage />
                  </RequestsRoute>
                }
              />
              <Route
                path="/app/requests/:serviceRequestId/edit"
                element={
                  <RequestsRoute>
                    <ServiceRequestEditPage />
                  </RequestsRoute>
                }
              />
              <Route
                path="/app/requests/:serviceRequestId"
                element={
                  <RequestsRoute>
                    <ServiceRequestDetailPage />
                  </RequestsRoute>
                }
              />
              <Route
                path="/app/proposals"
                element={
                  <ProposalsRoute>
                    <ProposalsListPage />
                  </ProposalsRoute>
                }
              />
              <Route
                path="/app/proposals/new"
                element={
                  <ProposalsRoute>
                    <ProposalCreatePage />
                  </ProposalsRoute>
                }
              />
              <Route
                path="/app/proposals/:proposalId/edit"
                element={
                  <ProposalsRoute>
                    <ProposalEditPage />
                  </ProposalsRoute>
                }
              />
              <Route
                path="/app/proposals/:proposalId"
                element={
                  <ProposalsRoute>
                    <ProposalDetailPage />
                  </ProposalsRoute>
                }
              />
              <Route
                path="/app/purchase-orders"
                element={
                  <PurchaseOrdersRoute>
                    <PurchaseOrdersListPage />
                  </PurchaseOrdersRoute>
                }
              />
              <Route
                path="/app/purchase-orders/new"
                element={
                  <PurchaseOrdersRoute>
                    <PurchaseOrderCreatePage />
                  </PurchaseOrdersRoute>
                }
              />
              <Route
                path="/app/purchase-orders/:purchaseOrderId/edit"
                element={
                  <PurchaseOrdersRoute>
                    <PurchaseOrderEditPage />
                  </PurchaseOrdersRoute>
                }
              />
              <Route
                path="/app/purchase-orders/:purchaseOrderId"
                element={
                  <PurchaseOrdersRoute>
                    <PurchaseOrderDetailPage />
                  </PurchaseOrdersRoute>
                }
              />
              <Route
                path="/app/contracts"
                element={
                  <ContractsRoute>
                    <ContractsListPage />
                  </ContractsRoute>
                }
              />
              <Route
                path="/app/contracts/new"
                element={
                  <ContractsRoute>
                    <ContractsCreatePage />
                  </ContractsRoute>
                }
              />
              <Route
                path="/app/contracts/:contractId"
                element={
                  <ContractsRoute>
                    <ContractsDetailPage />
                  </ContractsRoute>
                }
              />
              <Route
                path="/app/rentals"
                element={
                  <ServiceOrdersRoute>
                    <RentalsListPage />
                  </ServiceOrdersRoute>
                }
              />
              <Route
                path="/app/transport"
                element={
                  <ServiceOrdersRoute>
                    <TransportListPage />
                  </ServiceOrdersRoute>
                }
              />
              <Route
                path="/app/service-orders"
                element={
                  <ServiceOrdersRoute>
                    <ServiceOrdersEngineListPage />
                  </ServiceOrdersRoute>
                }
              />
              {/*
                CRIAÇÃO EM ROTA PRÓPRIA — o formulário NÃO abre inline sobre a worklist.

                A criação é um passo do fluxo, com endereço próprio: o operador pode voltar,
                compartilhar e recarregar sem perder os dados digitados, e a fila nunca é
                espremida por um formulário que ocupa a área de trabalho.
              */}
              <Route
                path="/app/service-orders/new"
                element={
                  <ServiceOrdersRoute>
                    <ServiceOrderCreatePage />
                  </ServiceOrdersRoute>
                }
              />
              <Route
                path="/app/service-orders/:serviceOrderId"
                element={
                  <ServiceOrdersRoute>
                    <ServiceOrderEngineDetailPage />
                  </ServiceOrdersRoute>
                }
              />
              <Route
                path="/app/service-orders/:serviceOrderId/planning"
                element={
                  <ServiceOrdersRoute>
                    <ServiceOrderPlanningPage />
                  </ServiceOrdersRoute>
                }
              />
              <Route
                path="/app/service-orders/:serviceOrderId/measurement"
                element={
                  <ServiceOrdersRoute>
                    <ServiceOrderMeasurementPage />
                  </ServiceOrdersRoute>
                }
              />
              {/*
               * MEASUREMENT → ACCEPTANCE → BILLING READINESS.
               *
               * `measurement-workbench` é a ESTAÇÃO de trabalho — fila,
               * medição ativa e contexto de decisão numa superfície só. A rota
               * `measurement` acima permanece: é a conferência do agregado, e
               * comandos existentes continuam chegando por ela.
               */}
              <Route
                path="/app/service-orders/:serviceOrderId/measurement-workbench"
                element={
                  <ServiceOrdersRoute>
                    <MeasurementWorkbenchPage />
                  </ServiceOrdersRoute>
                }
              />
              <Route
                path="/app/measurement"
                element={
                  <ServiceOrdersRoute>
                    <MeasurementWorkbenchPage />
                  </ServiceOrdersRoute>
                }
              />
              <Route
                path="/app/measurement/revenue-leakage"
                element={
                  <ServiceOrdersRoute>
                    <RevenueLeakagePage />
                  </ServiceOrdersRoute>
                }
              />
              <Route path="/app/documents" element={<DocumentsPage />} />
              <Route
                path="/app/billing"
                element={
                  <BillingRoute>
                    <BillingDashboardPage />
                  </BillingRoute>
                }
              />
              <Route
                path="/app/finance"
                element={
                  <FinanceRoute access="overview">
                    <FinanceOverviewPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/budgets"
                element={
                  <FinanceRoute access="budgets">
                    <BudgetsListPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/budgets/new"
                element={
                  <FinanceRoute access="budgets">
                    <BudgetsPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/budgets/:budgetId"
                element={
                  <FinanceRoute access="budgets">
                    <BudgetsPage />
                  </FinanceRoute>
                }
              />
              {/* Previsão de caixa: tela e controller ja existiam; faltava a rota. */}
              <Route
                path="/app/finance/forecast"
                element={
                  <FinanceRoute access="forecast">
                    <CashForecastPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/expenses"
                element={
                  <FinanceRoute access="expenses">
                    <ExpensesListPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/expenses/new"
                element={
                  <FinanceRoute access="expenses">
                    <ExpensesPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/expenses/:expenseId"
                element={
                  <FinanceRoute access="expenses">
                    <ExpensesPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/receivables"
                element={
                  <FinanceRoute access="receivables">
                    <ReceivablesListPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/receivables/:receivableId"
                element={
                  <FinanceRoute access="receivables">
                    <ReceivableDetailPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/payables"
                element={
                  <FinanceRoute access="payables">
                    <PayablesListPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/payables/:payableId"
                element={
                  <FinanceRoute access="payables">
                    <PayableDetailPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/treasury"
                element={
                  <FinanceRoute access="treasury">
                    <TreasuryListPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/treasury/:accountId"
                element={
                  <FinanceRoute access="treasury">
                    <TreasuryAccountDetailPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/finance/reconciliation"
                element={
                  <FinanceRoute access="reconciliation">
                    <BankReconciliationPage />
                  </FinanceRoute>
                }
              />
              {/* Seleção do extrato vive na URL: o operador abre a mesa já no extrato escolhido. */}
              <Route
                path="/app/finance/reconciliation/:statementId"
                element={
                  <FinanceRoute access="reconciliation">
                    <BankReconciliationPage />
                  </FinanceRoute>
                }
              />
              <Route
                path="/app/fiscal/documents"
                element={
                  <FiscalRoute access="documents">
                    <FiscalDocumentsPage />
                  </FiscalRoute>
                }
              />
              <Route
                path="/app/fiscal/documents/:fiscalDocumentId"
                element={
                  <FiscalRoute access="documents">
                    <FiscalDocumentsPage />
                  </FiscalRoute>
                }
              />
              <Route
                path="/app/fiscal/periods"
                element={
                  <FiscalRoute access="period">
                    <FiscalPeriodsPage />
                  </FiscalRoute>
                }
              />
              <Route
                path="/app/fiscal/periods/:periodId"
                element={
                  <FiscalRoute access="period">
                    <FiscalPeriodsPage />
                  </FiscalRoute>
                }
              />
              <Route
                path="/app/fiscal/assessments"
                element={
                  <FiscalRoute access="tax">
                    <TaxAssessmentsPage />
                  </FiscalRoute>
                }
              />
              <Route
                path="/app/fiscal/assessments/:assessmentId"
                element={
                  <FiscalRoute access="tax">
                    <TaxAssessmentsPage />
                  </FiscalRoute>
                }
              />
              <Route
                path="/app/fiscal/apuracao/:calculationId"
                element={
                  <FiscalRoute access="tax">
                    <FiscalApuracaoPage />
                  </FiscalRoute>
                }
              />
              <Route
                path="/app/fiscal/apuracao"
                element={
                  <FiscalRoute access="tax">
                    <FiscalApuracaoPage />
                  </FiscalRoute>
                }
              />
              <Route
                path="/app/fiscal/tributos"
                element={
                  <FiscalRoute access="tax">
                    <FiscalTributosPage />
                  </FiscalRoute>
                }
              />
              <Route
                path="/app/fiscal/tributos/:taxRuleId"
                element={
                  <FiscalRoute access="tax">
                    <FiscalTributosPage />
                  </FiscalRoute>
                }
              />
              <Route
                path="/app/accounting/chart"
                element={
                  <AccountingRoute>
                    <ChartOfAccountsPage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/accounting/journals"
                element={
                  <AccountingRoute>
                    <JournalsPage />
                  </AccountingRoute>
                }
              />
              {/*
                F1.1 — SUPERFÍCIE DA TRILHA ECONÔMICA.

                A worklist é o trabalho (contabilização pendente/falha). A trilha é a
                cadeia de UM fato até o lançamento. Ambas ficam sob AccountingRoute
                porque é ACCOUNTING que decide posting e é o journal que fecha a
                cadeia — a autorização real continua no backend.
              */}
              <Route
                path="/app/accounting/economic-posting"
                element={
                  <AccountingRoute>
                    <EconomicPostingWorklistPage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/accounting/economic-trace/:factKind/:factId"
                element={
                  <AccountingRoute>
                    <EconomicTracePage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/accounting/journals/:journalId"
                element={
                  <AccountingRoute>
                    <JournalsPage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/accounting/diario"
                element={
                  <AccountingRoute>
                    <JournalBookPage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/accounting/razao"
                element={
                  <AccountingRoute>
                    <GeneralLedgerPage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/accounting/balancete"
                element={
                  <AccountingRoute>
                    <TrialBalancePage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/accounting/dre"
                element={
                  <AccountingRoute>
                    <IncomeStatementPage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/accounting/balanco"
                element={
                  <AccountingRoute>
                    <BalanceSheetPage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/accounting/fechamentos"
                element={
                  <AccountingRoute>
                    <PeriodClosePage />
                  </AccountingRoute>
                }
              />
              {/* Superfície única de fechamento: unidade + período, sem identificador técnico. */}
              <Route
                path="/app/closing"
                element={
                  <AccountingRoute>
                    <ClosingCenterPage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/accounting/closing"
                element={<Navigate to="/app/closing" replace />}
              />
              <Route
                path="/app/accounting/origens"
                element={
                  <AccountingRoute>
                    <AccountingPostingOriginsPage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/accounting/fixed-assets"
                element={
                  <AccountingRoute access="fixed-assets">
                    <FixedAssetsPage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/accounting/fixed-assets/:registerId"
                element={
                  <AccountingRoute access="fixed-assets">
                    <FixedAssetsPage />
                  </AccountingRoute>
                }
              />
              <Route
                path="/app/procurement/invoices/:invoiceId"
                element={
                  <ProcurementRoute>
                    <SupplierInvoicePage />
                  </ProcurementRoute>
                }
              />
              <Route
                path="/app/procurement/invoices"
                element={
                  <ProcurementRoute>
                    <SupplierInvoicePage />
                  </ProcurementRoute>
                }
              />
              <Route
                path="/app/procurement/matches/:matchId"
                element={
                  <ProcurementRoute>
                    <ThreeWayMatchPage />
                  </ProcurementRoute>
                }
              />
              <Route
                path="/app/procurement/requests/new"
                element={
                  <ProcurementRoute>
                    <PurchaseRequestCreatePage />
                  </ProcurementRoute>
                }
              />
              <Route
                path="/app/procurement/requests/:requestId"
                element={
                  <ProcurementRoute>
                    <PurchaseRequestPage />
                  </ProcurementRoute>
                }
              />
              <Route
                path="/app/procurement/orders/:orderId"
                element={
                  <ProcurementRoute>
                    <PurchaseOrderPage />
                  </ProcurementRoute>
                }
              />
              <Route
                path="/app/procurement"
                element={
                  <ProcurementRoute>
                    <ProcurementHubPage />
                  </ProcurementRoute>
                }
              />
              <Route
                path="/app/inventory/items/:itemId"
                element={
                  <InventoryRoute>
                    <InventoryItemDetailPage />
                  </InventoryRoute>
                }
              />
              <Route
                path="/app/inventory/warehouses/:warehouseId"
                element={
                  <InventoryRoute>
                    <InventoryWarehouseDetailPage />
                  </InventoryRoute>
                }
              />
              <Route
                path="/app/inventory"
                element={
                  <InventoryRoute>
                    <InventoryPage />
                  </InventoryRoute>
                }
              />
              <Route
                path="/app/suppliers/new"
                element={
                  <SuppliersRoute>
                    <SupplierCreatePage />
                  </SuppliersRoute>
                }
              />
              <Route
                path="/app/suppliers/:supplierId"
                element={
                  <SuppliersRoute>
                    <SuppliersEngineDetailPage />
                  </SuppliersRoute>
                }
              />
              <Route
                path="/app/suppliers"
                element={
                  <SuppliersRoute>
                    <SuppliersEngineListPage />
                  </SuppliersRoute>
                }
              />
              <Route
                path="/app/payroll/periods/:periodId"
                element={
                  <PayrollRoute>
                    <PayrollPage />
                  </PayrollRoute>
                }
              />
              <Route
                path="/app/payroll"
                element={
                  <PayrollRoute>
                    <PayrollPage />
                  </PayrollRoute>
                }
              />
              <Route
                path="/app/service-orders/:serviceOrderId/billing/document"
                element={
                  <ServiceOrdersRoute>
                    <ServiceOrderBillingDocumentPage />
                  </ServiceOrdersRoute>
                }
              />
              <Route
                path="/app/service-orders/:serviceOrderId/billing"
                element={
                  <ServiceOrdersRoute>
                    <ServiceOrderBillingPage />
                  </ServiceOrdersRoute>
                }
              />
              <Route path="/app/no-access" element={<ShellAccessDeniedPage />} />
              {/*
                EXPLORADOR DE METADADOS — a superfície read-write do metadata store.
                Fica fora de `/app/access-admin` porque não administra ACESSO: administra a
                FORMA das telas (campos, views, layout), que é outra responsabilidade.
              */}
              <Route path="/app/admin/metadata" element={<MetadataExplorerPage />} />
              {/*
                BANCADA DAS VIEWS V4 — prova as capacidades que o CHECK de `meta.views` ainda
                não permite declarar no store (pivot/tree/graph). Ver o cabeçalho do componente.
              */}
              <Route path="/app/admin/view-lab" element={<ViewLabPage />} />
              <Route path="*" element={<ShellNotFoundPage />} />
            </Route>
          </Route>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="*" element={<ShellNotFoundPage />} />
                  </Routes>
    </Suspense>
  );
}
