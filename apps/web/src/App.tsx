import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/context/AuthProvider';
import { ProtectedRoute } from './auth/components/ProtectedRoute';
import { CapabilityRoute } from './shell/CapabilityRoute';
import { AppShellLayout } from './shell/AppShellLayout';
import { ClientsRoute } from './clients/ClientsRoute';
import { ClientCreatePage } from './clients/pages/ClientCreatePage';
import { ClientDetailPage } from './clients/pages/ClientDetailPage';
import { ClientEditPage } from './clients/pages/ClientEditPage';
import { ClientsListPage } from './clients/pages/ClientsListPage';
import { PeopleRoute } from './people/PeopleRoute';
import { PeopleListPage } from './people/pages/PeopleListPage';
import { PersonCreatePage } from './people/pages/PersonCreatePage';
import { PersonDetailPage } from './people/pages/PersonDetailPage';
import { PersonEditPage } from './people/pages/PersonEditPage';
import { CatalogRoute } from './catalog/CatalogRoute';
import { ServiceDefinitionComparePage } from './catalog/pages/ServiceDefinitionComparePage';
import { ServiceDefinitionCreatePage } from './catalog/pages/ServiceDefinitionCreatePage';
import { ServiceDefinitionDetailPage } from './catalog/pages/ServiceDefinitionDetailPage';
import { ServiceDefinitionDraftEditPage } from './catalog/pages/ServiceDefinitionDraftEditPage';
import { ServiceDefinitionVersionCreatePage } from './catalog/pages/ServiceDefinitionVersionCreatePage';
import { ServiceDefinitionVersionDetailPage } from './catalog/pages/ServiceDefinitionVersionDetailPage';
import { ServiceDefinitionsListPage } from './catalog/pages/ServiceDefinitionsListPage';
import { BillingRoute } from './billing/BillingRoute';
import { DocumentsPage } from './documents/pages/DocumentsPage';
import { BillingDashboardPage } from './billing/pages/BillingDashboardPage';
import { ServiceOrderBillingDocumentPage } from './billing/pages/ServiceOrderBillingDocumentPage';
import { ServiceOrderBillingPage } from './billing/pages/ServiceOrderBillingPage';
import { AccessDeniedPage } from './pages/AccessDeniedPage';
import { PhysicalAssetCreatePage } from './assets/pages/PhysicalAssetCreatePage';
import { PhysicalAssetDetailPage } from './assets/pages/PhysicalAssetDetailPage';
import { PhysicalAssetEditPage } from './assets/pages/PhysicalAssetEditPage';
import { PhysicalAssetsListPage } from './assets/pages/PhysicalAssetsListPage';
import { AssetsRoute } from './assets/AssetsRoute';
import { FleetListPage } from './fleet/pages/FleetListPage';
import { RentalsListPage } from './rentals/pages/RentalsListPage';
import { TransportListPage } from './transport/pages/TransportListPage';
import { RequestsRoute } from './requests/RequestsRoute';
import { ServiceOrdersRoute } from './service-orders/ServiceOrdersRoute';
import { ServiceOrderPlanningPage } from './service-orders/pages/ServiceOrderPlanningPage';
import { ServiceOrdersListPage } from './service-orders/pages/ServiceOrdersListPage';
import { ExecutionShellLayout } from './service-orders/layout/ExecutionShellLayout';
import { ServiceOrderExecutionPage } from './service-orders/pages/ServiceOrderExecutionPage';
import { ServiceOrderMeasurementPage } from './service-orders/pages/ServiceOrderMeasurementPage';
import { ServiceRequestCreatePage } from './requests/pages/ServiceRequestCreatePage';
import { ServiceRequestDetailPage } from './requests/pages/ServiceRequestDetailPage';
import { ServiceRequestEditPage } from './requests/pages/ServiceRequestEditPage';
import { ServiceRequestsListPage } from './requests/pages/ServiceRequestsListPage';
import { ProposalsRoute } from './proposals/ProposalsRoute';
import { ProposalsListPage } from './proposals/pages/ProposalsListPage';
import { ProposalCreatePage } from './proposals/pages/ProposalCreatePage';
import { ProposalDetailPage } from './proposals/pages/ProposalDetailPage';
import { ProposalEditPage } from './proposals/pages/ProposalEditPage';
import { PurchaseOrdersRoute } from './purchase-orders/PurchaseOrdersRoute';
import { PurchaseOrdersListPage } from './purchase-orders/pages/PurchaseOrdersListPage';
import { PurchaseOrderCreatePage } from './purchase-orders/pages/PurchaseOrderCreatePage';
import { PurchaseOrderDetailPage } from './purchase-orders/pages/PurchaseOrderDetailPage';
import { PurchaseOrderEditPage } from './purchase-orders/pages/PurchaseOrderEditPage';
import { ContractsRoute } from './contracts/ContractsRoute';
import { ContractsListPage } from './contracts/pages/ContractsListPage';
import { ContractsCreatePage } from './contracts/pages/ContractsCreatePage';
import { ContractsDetailPage } from './contracts/pages/ContractsDetailPage';
import { OperationalDashboardPage } from './dashboard/pages/OperationalDashboardPage';
import { AlertCenterPage } from './alerts/pages/AlertCenterPage';
import { WorkInboxPage } from './operator/work-inbox/WorkInboxPage';
import { SearchResultsPage } from './search/pages/SearchResultsPage';
import { ReportsPage } from './reports/pages/ReportsPage';
import { OperationalProfitabilityPage } from './analytics/pages/OperationalProfitabilityPage';
import { ComplianceBiPage } from './analytics/pages/ComplianceBiPage';
import { ModulesRegistryPage } from './modules-registry/ModulesRegistryPage';
import { LoginPage } from './pages/LoginPage';
import { PlatformDiagnosticsPage } from './pages/PlatformDiagnosticsPage';
import { ServiceUnavailablePage } from './pages/ServiceUnavailablePage';
import { ShellAccessDeniedPage } from './pages/ShellAccessDeniedPage';
import { ShellNotFoundPage } from './pages/ShellNotFoundPage';
import { SessionExpiredPage } from './pages/SessionExpiredPage';
import { FinanceRoute } from './finance/FinanceRoute';
import { FinanceOverviewPage } from './finance/pages/FinanceOverviewPage';
import { ReceivablesListPage } from './finance/pages/ReceivablesListPage';
import { ReceivableDetailPage } from './finance/pages/ReceivableDetailPage';
import { PayablesListPage } from './finance/pages/PayablesListPage';
import { PayableDetailPage } from './finance/pages/PayableDetailPage';
import { TreasuryListPage } from './finance/pages/TreasuryListPage';
import { TreasuryAccountDetailPage } from './finance/pages/TreasuryAccountDetailPage';
import { BankReconciliationPage } from './finance/pages/BankReconciliationPage';
import { ExpensesListPage } from './finance/pages/ExpensesListPage';
import { ExpensesPage } from './finance/pages/ExpensesPage';
import { BudgetsListPage } from './finance/pages/BudgetsListPage';
import { BudgetsPage } from './finance/pages/BudgetsPage';
import { FiscalRoute } from './fiscal/FiscalRoute';
import { FiscalDocumentsPage } from './fiscal/pages/FiscalDocumentsPage';
import { FiscalPeriodsPage } from './fiscal/pages/FiscalPeriodsPage';
import { TaxAssessmentsPage } from './fiscal/pages/TaxAssessmentsPage';
import { FiscalApuracaoPage } from './fiscal/pages/FiscalApuracaoPage';
import { FiscalTributosPage } from './fiscal/pages/FiscalTributosPage';
import { AccountingRoute } from './accounting/AccountingRoute';
import { ChartOfAccountsPage } from './accounting/pages/ChartOfAccountsPage';
import { JournalsPage } from './accounting/pages/JournalsPage';
import {
  BalanceSheetPage,
  GeneralLedgerPage,
  IncomeStatementPage,
  JournalBookPage,
  TrialBalancePage,
} from './accounting/pages/PeriodReportPages';
import { PeriodClosePage } from './accounting/pages/PeriodClosePage';
import { AccountingPostingOriginsPage } from './accounting/pages/AccountingPostingOriginsPage';
import { FixedAssetsPage } from './accounting/pages/FixedAssetsPage';
import {
  ProcurementRoute,
  ProcurementHubPage,
  PurchaseRequestCreatePage,
  PurchaseRequestPage,
  PurchaseOrderPage,
  SupplierInvoicePage,
  ThreeWayMatchPage,
} from './procurement/pages/ProcurementPages';
import {
  InventoryItemDetailPage,
  InventoryPage,
  InventoryRoute,
  InventoryWarehouseDetailPage,
} from './inventory/pages/InventoryPage';
import { PayrollRoute, PayrollPage } from './payroll/pages/PayrollPage';
import { SupplierCreatePage } from './suppliers/pages/SupplierCreatePage';
import { SuppliersListPage } from './suppliers/pages/SuppliersListPage';
import { SuppliersPage, SuppliersRoute } from './suppliers/pages/SuppliersPage';
import { AccessAdminRoute } from './access-admin/AccessAdminRoute';
import { AccessAdminPage } from './access-admin/pages/AccessAdminPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
              <Route path="/app/work-inbox" element={<WorkInboxPage />} />
              <Route path="/app/search" element={<SearchResultsPage />} />
              <Route path="/app/reports" element={<ReportsPage />} />
              <Route path="/app/operational-profitability" element={<OperationalProfitabilityPage />} />
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
                    <ServiceOrdersListPage />
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
                    <SuppliersPage />
                  </SuppliersRoute>
                }
              />
              <Route
                path="/app/suppliers"
                element={
                  <SuppliersRoute>
                    <SuppliersListPage />
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
              <Route path="*" element={<ShellNotFoundPage />} />
            </Route>
          </Route>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="*" element={<ShellNotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
