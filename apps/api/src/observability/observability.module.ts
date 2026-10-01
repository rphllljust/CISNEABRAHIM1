import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { ObservabilityController } from './controllers/observability.controller';
import { ObservabilityContextInterceptor } from './interceptors/observability-context.interceptor';
import { StructuredLoggerService } from './logging/structured-logger.service';
import { MetricsRegistryService } from './metrics/metrics-registry.service';
import { PrometheusMetricsService } from './metrics/prometheus-metrics.service';
import { BusinessMetricsCollectorService } from './services/business-metrics-collector.service';
import { DatabaseInstrumentationService } from './services/database-instrumentation.service';
import { ObservabilityMetricsService } from './services/observability-metrics.service';
import { PlatformMetricsCollectorService } from './services/platform-metrics-collector.service';
import { TechnicalAlertService } from './services/technical-alert.service';

@Global()
@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [ObservabilityController],
  providers: [
    MetricsRegistryService,
    PrometheusMetricsService,
    StructuredLoggerService,
    ObservabilityContextInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: ObservabilityContextInterceptor,
    },
    DatabaseInstrumentationService,
    PlatformMetricsCollectorService,
    BusinessMetricsCollectorService,
    ObservabilityMetricsService,
    TechnicalAlertService,
  ],
  exports: [
    MetricsRegistryService,
    PrometheusMetricsService,
    StructuredLoggerService,
    ObservabilityContextInterceptor,
    DatabaseInstrumentationService,
    PlatformMetricsCollectorService,
    BusinessMetricsCollectorService,
    ObservabilityMetricsService,
    TechnicalAlertService,
  ],
})
export class ObservabilityModule {}
