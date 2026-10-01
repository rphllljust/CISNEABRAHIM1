import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequireAuthz } from '../../authorization/decorators/require-authz.decorator';
import { AuthorizationGuard } from '../../authorization/guards/authorization.guard';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { buildArtifactIdentitySnapshot } from '../artifact/artifact-identity';
import {
  PROMETHEUS_CONTENT_TYPE,
  PrometheusMetricsService,
} from '../metrics/prometheus-metrics.service';
import {
  ObservabilityMetricsService,
  type ObservabilityMetricsResponse,
} from '../services/observability-metrics.service';
import {
  TechnicalAlertService,
  type TechnicalAlertsResponse,
} from '../services/technical-alert.service';

@Controller('observability')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class ObservabilityController {
  constructor(
    private readonly metricsService: ObservabilityMetricsService,
    private readonly technicalAlerts: TechnicalAlertService,
    private readonly prometheus: PrometheusMetricsService,
  ) {}

  @Get('metrics')
  @RequireAuthz({
    action: AUTHZ_ACTIONS.PlatformDiagnosticsRead,
    resourceType: AUTHZ_RESOURCE_TYPES.Platform,
  })
  async getMetrics(): Promise<ObservabilityMetricsResponse> {
    return this.metricsService.collect();
  }

  /**
   * Exposition format do Prometheus.
   *
   * DECISAO DE DESIGN (B3): autenticado e autorizado com o MESMO contrato do
   * `/observability/metrics` (`platform:diagnostics:read`), e nao anonimo.
   * O repositorio nao possui permissao `observability:read` e cria-la exigiria
   * tocar em `authorization/` e no schema de grants — ambos fora de escopo.
   * Um endpoint anonimo aqui seria a unica superficie de diagnostico do sistema
   * sem autenticacao, contradizendo o modelo fail-closed ja provado em
   * `observability-metrics.e2e.spec.ts`. O scrape deve usar as mesmas
   * credenciais que ja acessam o diagnostico de plataforma.
   */
  @Get('prometheus')
  @RequireAuthz({
    action: AUTHZ_ACTIONS.PlatformDiagnosticsRead,
    resourceType: AUTHZ_RESOURCE_TYPES.Platform,
  })
  @Header('content-type', PROMETHEUS_CONTENT_TYPE)
  async getPrometheusMetrics(): Promise<string> {
    return this.prometheus.render();
  }

  @Get('alerts')
  @RequireAuthz({
    action: AUTHZ_ACTIONS.PlatformDiagnosticsRead,
    resourceType: AUTHZ_RESOURCE_TYPES.Platform,
  })
  async getTechnicalAlerts(): Promise<TechnicalAlertsResponse> {
    return this.technicalAlerts.evaluate();
  }

  /**
   * Identidade do artefato em execução (prova HML SHA / artefato aprovado /
   * produção SHA). Endpoint autenticado e autorizado (platform:diagnostics:read);
   * expõe somente campos whitelisted sanitizados por buildArtifactIdentitySnapshot
   * — nunca segredos ou conteúdo arbitrário de ambiente.
   */
  @Get('artifact')
  @RequireAuthz({
    action: AUTHZ_ACTIONS.PlatformDiagnosticsRead,
    resourceType: AUTHZ_RESOURCE_TYPES.Platform,
  })
  getArtifactIdentity() {
    return buildArtifactIdentitySnapshot(process.env);
  }
}
