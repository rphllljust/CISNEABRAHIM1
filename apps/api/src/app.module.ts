import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AlertsModule } from './alerts/alerts.module';
import { WorkInboxModule } from './work-inbox/work-inbox.module';
import { BusinessChainModule } from './business-chain/business-chain.module';
import { IntegrationsAclModule } from './integrations/acl/integrations-acl.module';
import { IntegrationsInboxModule } from './integrations/inbox/integrations-inbox.module';
import { BackgroundJobsModule } from './platform/background-jobs/background-jobs.module';
import { OutboxModule } from './platform/outbox/outbox.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { CatalogModule } from './catalog/catalog.module';
import { ClientsModule } from './clients/clients.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { ProcurementModule } from './procurement/procurement.module';
import { CommercialModule } from './commercial/commercial.module';
import { DocumentsModule } from './documents/documents.module';
import { SecurityModule } from './security/security.module';
import { ObservabilityModule } from './observability/observability.module';
import { HealthModule } from './health/health.module';
import { RequestsModule } from './requests/requests.module';
import { ResourcesModule } from './resources/resources.module';
import { MeasurementsModule } from './measurements/measurements.module';
import { BillingModule } from './billing/billing.module';
import { FinanceModule } from './finance/finance.module';
import { AccountingModule } from './accounting/accounting.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { InventoryModule } from './inventory/inventory.module';
import { PayrollModule } from './payroll/payroll.module';
import { EventsModule } from './events/events.module';
import { SearchModule } from './search/search.module';
import { ReportsModule } from './reports/reports.module';
import { ServiceOrdersModule } from './service-orders/service-orders.module';
import { PeopleModule } from './people/people.module';
import { IssuerRegistryModule } from './establishments/issuer-registry.module';
import { FaultInjectionModule } from './platform/fault-injection/fault-injection.module';
import { ReleaseScopeGuard } from './platform/release-scope/release-scope.guard';
import { ModuleRegistryModule } from './platform/module-registry/module-registry.module';

@Module({
  imports: [ModuleRegistryModule, FaultInjectionModule, SecurityModule, ObservabilityModule, HealthModule, AuditModule, AuthModule, AuthorizationModule, ClientsModule, SuppliersModule, PeopleModule, IssuerRegistryModule, CatalogModule, CommercialModule, ProcurementModule, RequestsModule, ServiceOrdersModule, MeasurementsModule, BillingModule, FinanceModule, AccountingModule, FiscalModule, InventoryModule, PayrollModule, ResourcesModule, DocumentsModule, EventsModule, NotificationsModule, DashboardModule, AnalyticsModule, AlertsModule, WorkInboxModule, BusinessChainModule, SearchModule, ReportsModule, BackgroundJobsModule, OutboxModule, IntegrationsAclModule, IntegrationsInboxModule],
  providers: [{ provide: APP_GUARD, useClass: ReleaseScopeGuard }],
})
export class AppModule {}
