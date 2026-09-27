import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import {
  FEATURE_FLAG_ENV,
  GATED_API_PATH_PREFIXES,
  GATED_MODULE_IDS,
  matchGatedApiPath,
  type GatedModuleId,
} from '../release-scope/release-1-scope';
import { isReleaseModuleEnabled } from '../release-scope/feature-flags';

export type ModuleRegistryDomain =
  | 'Operacional'
  | 'Comercial'
  | 'Financeiro'
  | 'Contábil'
  | 'Fiscal'
  | 'Recursos'
  | 'Suprimentos'
  | 'Sistema';

/**
 * Semântica dos status (fonte única: release-scope feature flags no servidor):
 * - available     => módulo SEM feature gate no release-scope. Não significa
 *                    "ativado manualmente": não existe ativação por fora da
 *                    flag — módulo sem gate está, por definição, no escopo.
 * - enabled       => módulo gated cuja flag de release está exatamente 'true'
 *                    (isReleaseModuleEnabled é fail-closed).
 * - not_released  => módulo gated com flag ausente/≠'true' (fora do escopo).
 */
export type ModuleRegistryStatus = 'available' | 'enabled' | 'not_released';

export type ModuleRegistryDefinition = {
  moduleCode: string;
  name: string;
  description: string;
  domain: ModuleRegistryDomain;
  authzDomains: string[];
  declaredCapabilities?: string[];
  declaredResources?: string[];
  gatedModuleId?: GatedModuleId;
  routes: string[];
  dependencies?: string[];
};

export type ModuleRegistryDetail = {
  moduleCode: string;
  name: string;
  description: string;
  domain: ModuleRegistryDomain;
  status: ModuleRegistryStatus;
  availability: boolean;
  reasons: string[];
  featureFlag: string | null;
  dependencies: string[];
  capabilities: string[];
  resources: string[];
  routes: string[];
};

export type ModuleRegistrySummary = {
  moduleCode: string;
  name: string;
  description: string;
  domain: ModuleRegistryDomain;
  status: ModuleRegistryStatus;
  availability: boolean;
  reasons: string[];
  dependencies: string[];
};

const ALL_ACTIONS = new Set<string>(Object.values(AUTHZ_ACTIONS));
const ALL_RESOURCES = new Set<string>(Object.values(AUTHZ_RESOURCE_TYPES));

function byAuthzDomain(domains: string[], values: Iterable<string>): string[] {
  return [...values].filter((value) => domains.some((domain) => value === domain || value.startsWith(`${domain}:`)));
}

/**
 * Registry canônico — fonte única do catálogo de módulos do servidor.
 * Rotas são metadata declarativa do registry e devem refletir os prefixos
 * reais de gate (GATED_API_PATH_PREFIXES); a integridade é verificada por
 * assertModuleRegistryIntegrity em build e no boot do módulo.
 */
export const MODULE_REGISTRY_DEFINITIONS: ModuleRegistryDefinition[] = [
  { moduleCode: 'clients', name: 'Clientes', description: 'Cadastro e ciclo de vida dos clientes atendidos pelo Cisne.', domain: 'Comercial', authzDomains: ['client'], routes: ['/api/v1/clients'] },
  { moduleCode: 'catalog', name: 'Catálogo de serviços e unidades', description: 'Serviços, unidades de medida e precificação oferecidos.', domain: 'Comercial', authzDomains: ['catalog'], routes: ['/api/v1/catalog'] },
  { moduleCode: 'requests', name: 'Solicitações de serviço', description: 'Entrada controlada da demanda até a conversão em ordem de serviço.', domain: 'Operacional', authzDomains: ['requests'], routes: ['/api/v1/requests/service-requests'] },
  { moduleCode: 'service-orders', name: 'Ordens de serviço', description: 'Planejamento, execução, medição e faturamento interno das ordens de serviço.', domain: 'Operacional', authzDomains: ['service-orders', 'measurements', 'billing'], routes: ['/api/v1/service-orders'] },
  { moduleCode: 'commercial', name: 'Comercial', description: 'Propostas, pedidos de compra, políticas e contratos comerciais.', domain: 'Comercial', authzDomains: ['commercial'], routes: ['/api/v1/commercial'] },
  { moduleCode: 'documents', name: 'Documentos', description: 'Gestão documental com versionamento, armazenamento e download seguro.', domain: 'Sistema', authzDomains: ['documents'], routes: ['/api/v1/documents'] },
  { moduleCode: 'resources', name: 'Ativos e recursos', description: 'Tipos de recursos, ativos físicos e tipos de mão de obra.', domain: 'Recursos', authzDomains: ['resources'], routes: ['/api/v1/resources'] },
  { moduleCode: 'people', name: 'Pessoas', description: 'Cadastro de pessoas vinculadas à operação.', domain: 'Recursos', authzDomains: ['people'], gatedModuleId: 'people', routes: ['/api/v1/people'] },
  { moduleCode: 'finance', name: 'Financeiro', description: 'Contas a receber, a pagar, tesouraria, despesas e orçamento.', domain: 'Financeiro', authzDomains: ['finance'], gatedModuleId: 'finance', routes: ['/api/v1/finance'] },
  { moduleCode: 'accounting', name: 'Contabilidade', description: 'Plano de contas, lançamentos, relatórios contábeis e fechamento de período.', domain: 'Contábil', authzDomains: ['accounting'], gatedModuleId: 'accounting', routes: ['/api/v1/accounting'] },
  /**
   * SUPERFÍCIE TRANSVERSAL DECLARADA (decisão registrada em 2026-09-27).
   *
   * A Central de fechamento reúne a prontidão de uma unidade+competência atravessando
   * contas a receber, contas a pagar, tesouraria, conciliação, fiscal e contábil — não é
   * um módulo de um único domínio. Por isso ela NÃO carrega `gatedModuleId` do contábil:
   * o comportamento anterior era acidental (menu escondia, rota respondia). A autorização
   * continua sendo decidida por capability no backend (`accounting:journal:read`).
   */
  { moduleCode: 'closing', name: 'Central de fechamento', description: 'Superfície transversal de fechamento: prontidão contábil, fiscal e financeira de uma unidade e competência.', domain: 'Contábil', authzDomains: ['accounting', 'fiscal', 'finance'], routes: ['/api/v1/closing'] },
  { moduleCode: 'fiscal', name: 'Fiscal', description: 'Documentos fiscais, motor de tributos e obrigações tributárias.', domain: 'Fiscal', authzDomains: ['fiscal'], gatedModuleId: 'fiscal', routes: ['/api/v1/fiscal'] },
  { moduleCode: 'inventory', name: 'Estoque', description: 'Itens, saldos, movimentações e custeio de estoque.', domain: 'Suprimentos', authzDomains: ['inventory'], gatedModuleId: 'inventory', routes: ['/api/v1/inventory'] },
  { moduleCode: 'payroll', name: 'Folha de pagamento', description: 'Contratos, períodos e regras versionadas de folha.', domain: 'Recursos', authzDomains: ['payroll'], gatedModuleId: 'payroll', routes: ['/api/v1/payroll'] },
  { moduleCode: 'procurement', name: 'Compras e suprimentos', description: 'Requisições, pedidos, recebimento e conferência (three-way match).', domain: 'Suprimentos', authzDomains: ['procurement'], gatedModuleId: 'procurement', routes: ['/api/v1/procurement', '/api/v1/supplier-invoices', '/api/v1/three-way-matches'] },
  { moduleCode: 'suppliers', name: 'Fornecedores', description: 'Cadastro e versionamento de fornecedores.', domain: 'Suprimentos', authzDomains: ['supplier'], gatedModuleId: 'suppliers', routes: ['/api/v1/suppliers'] },
  { moduleCode: 'contracts', name: 'Contratos comerciais', description: 'Vigência, versionamento imutável e expiração de contratos.', domain: 'Comercial', authzDomains: ['commercial'], gatedModuleId: 'contracts', routes: ['/api/v1/commercial/contracts'] },
  { moduleCode: 'issuer', name: 'Cadastro e emissão', description: 'Cadastro da própria empresa (legal entity, estabelecimento e CNPJ emissor).', domain: 'Fiscal', authzDomains: ['issuer'], routes: ['/api/v1/establishments', '/api/v1/issuer/establishments'] },
  { moduleCode: 'alerts', name: 'Alertas', description: 'Alertas operacionais e de negócio.', domain: 'Sistema', authzDomains: [], gatedModuleId: 'alerts', routes: ['/api/v1/alerts'] },
  /**
   * FRONTEIRA COM O ALERT CENTER (decisão registrada em 2026-09-27).
   *
   * Alert Center = notificação/evento (o que aconteceu, política de avaliação e transição).
   * Central de trabalho = trabalho acionável (o que exige ação agora, com motivo e rota de
   * resolução). A fila LÊ alertas como uma das fontes, mas não é uma segunda caixa de
   * notificações: ela não cria evento, não avalia política e não persiste estado próprio.
   */
  { moduleCode: 'work-inbox', name: 'Central de trabalho', description: 'Fila única de trabalho autorizado de todos os domínios, somente leitura e sem estado próprio.', domain: 'Sistema', authzDomains: [], routes: ['/api/v1/work-inbox'] },
  { moduleCode: 'reports', name: 'Relatórios', description: 'Relatórios e exportações operacionais.', domain: 'Sistema', authzDomains: [], gatedModuleId: 'reports', routes: ['/api/v1/reports'] },
  { moduleCode: 'approval-matrix', name: 'Matrizes de aprovação', description: 'Regras de aprovação financeira por matriz.', domain: 'Financeiro', authzDomains: ['authz'], gatedModuleId: 'approval-matrix', routes: ['/api/v1/authz/approval-matrices'] },
  { moduleCode: 'operational-profitability', name: 'Rentabilidade operacional', description: 'Análise de rentabilidade por ordem de serviço.', domain: 'Contábil', authzDomains: [], gatedModuleId: 'operational-profitability', routes: ['/api/v1/analytics/operational-profitability'] },
];

export function assertRegistryDefinitions(definitions: ModuleRegistryDefinition[]): void {
  for (const definition of definitions) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(definition.moduleCode)) {
      throw new Error(`MODULE_REGISTRY_INVALID_CODE: ${definition.moduleCode}`);
    }
    if (definition.routes.length === 0 || definition.routes.some((route) => !route.startsWith('/api/v1/'))) {
      throw new Error(`MODULE_REGISTRY_INVALID_ROUTES: ${definition.moduleCode}`);
    }
    if (definition.name.trim().length === 0 || definition.description.trim().length === 0) {
      throw new Error(`MODULE_REGISTRY_INVALID_LABEL: ${definition.moduleCode}`);
    }
    if (definition.gatedModuleId !== undefined && !GATED_MODULE_IDS.includes(definition.gatedModuleId)) {
      throw new Error(`MODULE_REGISTRY_INVALID_GATE: ${definition.moduleCode} -> ${definition.gatedModuleId}`);
    }
    for (const capability of definition.declaredCapabilities ?? []) {
      if (!ALL_ACTIONS.has(capability)) {
        throw new Error(`MODULE_REGISTRY_INVENTED_CAPABILITY: ${definition.moduleCode} -> ${capability}`);
      }
    }
    for (const resource of definition.declaredResources ?? []) {
      if (!ALL_RESOURCES.has(resource)) {
        throw new Error(`MODULE_REGISTRY_INVENTED_RESOURCE: ${definition.moduleCode} -> ${resource}`);
      }
    }
  }
}

/**
 * Invariantes do registry (fonte única). Roda no boot (fail fast) e em build.
 * Detecções: moduleCode duplicado, nome duplicado, rota duplicada entre
 * módulos, dependência para módulo inexistente, autodependência,
 * dependência duplicada, ciclos de dependência, flag de release duplicada,
 * rota sob prefixo gated em módulo não-gated e rota fora do próprio gate em
 * módulo gated (compatibilidade com GATED_API_PATH_PREFIXES real do guard).
 */
export function validateModuleRegistryIntegrity(definitions: ModuleRegistryDefinition[]): string[] {
  const errors: string[] = [];
  const byCode = new Map<string, ModuleRegistryDefinition>();
  const codeOwners: Record<string, string> = {};
  const nameOwners = new Map<string, string>();
  const routeOwners = new Map<string, string>();
  const flagOwners = new Map<string, string>();
  const gatedPrefixes = new Map<GatedModuleId, boolean>(
    GATED_MODULE_IDS.map((moduleId) => [moduleId, GATED_API_PATH_PREFIXES.some((entry) => entry.moduleId === moduleId)]),
  );

  for (const definition of definitions) {
    if (codeOwners[definition.moduleCode] !== undefined) {
      errors.push(`MODULE_REGISTRY_DUPLICATE_MODULE_CODE: ${definition.moduleCode}`);
    } else {
      codeOwners[definition.moduleCode] = definition.moduleCode;
    }
    byCode.set(definition.moduleCode, definition);

    const nameOwner = nameOwners.get(definition.name);
    if (nameOwner !== undefined && nameOwner !== definition.moduleCode) {
      errors.push(
        `MODULE_REGISTRY_DUPLICATE_MODULE_NAME: ${definition.name} (${nameOwner} e ${definition.moduleCode})`,
      );
    } else {
      nameOwners.set(definition.name, definition.moduleCode);
    }

    if (definition.gatedModuleId !== undefined) {
      const flag = FEATURE_FLAG_ENV[definition.gatedModuleId];
      if (flag === undefined) {
        errors.push(`MODULE_REGISTRY_INVALID_FEATURE_FLAG: ${definition.moduleCode} -> ${definition.gatedModuleId}`);
      } else {
        const flagOwner = flagOwners.get(flag);
        if (flagOwner !== undefined && flagOwner !== definition.moduleCode) {
          errors.push(`MODULE_REGISTRY_SHARED_FEATURE_FLAG: ${flag} (${flagOwner} e ${definition.moduleCode})`);
        } else {
          flagOwners.set(flag, definition.moduleCode);
        }
      }
      if (!(gatedPrefixes.get(definition.gatedModuleId) ?? false)) {
        errors.push(
          `MODULE_REGISTRY_GATE_WITHOUT_API_PREFIX: ${definition.moduleCode} -> ${definition.gatedModuleId}`,
        );
      }
    }

    for (const route of definition.routes) {
      const gateId = matchGatedApiPath(route);
      if (definition.gatedModuleId === undefined) {
        if (gateId !== null) {
          errors.push(
            `MODULE_REGISTRY_ENDPOINT_GATE_MISMATCH: módulo não-gated ${definition.moduleCode} declara rota sob gate ${gateId}: ${route}`,
          );
        }
      } else if (gateId !== definition.gatedModuleId) {
        errors.push(
          `MODULE_REGISTRY_ENDPOINT_GATE_MISMATCH: rota ${route} de ${definition.moduleCode} não está sob o próprio gate ${definition.gatedModuleId} (mapeou ${gateId ?? 'nenhum'})`,
        );
      }

      const routeOwner = routeOwners.get(route);
      if (routeOwner !== undefined && routeOwner !== definition.moduleCode) {
        errors.push(`MODULE_REGISTRY_ROUTE_DUPLICATE: ${route} (${routeOwner} e ${definition.moduleCode})`);
      } else {
        routeOwners.set(route, definition.moduleCode);
      }
    }
  }

  // Dependências: existência, autodependência, duplicatas e ciclos.
  for (const definition of definitions) {
    const dependencies = definition.dependencies ?? [];
    const seen = new Set<string>();
    for (const dependency of dependencies) {
      if (dependency === definition.moduleCode) {
        errors.push(`MODULE_REGISTRY_SELF_DEPENDENCY: ${definition.moduleCode}`);
      }
      if (!byCode.has(dependency)) {
        errors.push(`MODULE_REGISTRY_DEPENDENCY_MISSING: ${definition.moduleCode} -> ${dependency}`);
      }
      if (seen.has(dependency)) {
        errors.push(`MODULE_REGISTRY_DUPLICATE_DEPENDENCY: ${definition.moduleCode} -> ${dependency}`);
      }
      seen.add(dependency);
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const visit = (code: string, trail: string[]): void => {
    const state = color.get(code) ?? WHITE;
    if (state === BLACK) return;
    if (state === GRAY) {
      const cycle = [...trail.slice(trail.indexOf(code)), code].join(' -> ');
      errors.push(`MODULE_REGISTRY_DEPENDENCY_CYCLE: ${cycle}`);
      return;
    }
    color.set(code, GRAY);
    for (const dependency of byCode.get(code)?.dependencies ?? []) {
      if (byCode.has(dependency)) visit(dependency, [...trail, code]);
    }
    color.set(code, BLACK);
  };
  for (const definition of definitions) {
    visit(definition.moduleCode, []);
  }

  return errors;
}

export function assertModuleRegistryIntegrity(definitions: ModuleRegistryDefinition[]): void {
  const errors = validateModuleRegistryIntegrity(definitions);
  if (errors.length > 0) {
    throw new Error(`MODULE_REGISTRY_INTEGRITY_FAILED (${errors.length}):\n- ${errors.join('\n- ')}`);
  }
}

function statusFor(definition: ModuleRegistryDefinition, env: NodeJS.ProcessEnv): ModuleRegistryStatus {
  if (definition.gatedModuleId === undefined) {
    return 'available';
  }
  return isReleaseModuleEnabled(definition.gatedModuleId, env) ? 'enabled' : 'not_released';
}

function reasonsFor(status: ModuleRegistryStatus, definition: ModuleRegistryDefinition): string[] {
  if (status === 'not_released') {
    return definition.gatedModuleId ? ['FEATURE_DISABLED', 'RELEASE_SCOPE_GATED'] : ['RELEASE_SCOPE_GATED'];
  }
  return [];
}

export function buildModuleRegistry(
  definitions = MODULE_REGISTRY_DEFINITIONS,
  env: NodeJS.ProcessEnv = process.env,
): ModuleRegistryDetail[] {
  assertRegistryDefinitions(definitions);
  assertModuleRegistryIntegrity(definitions);
  return definitions.map((definition) => {
    const status = statusFor(definition, env);
    const derivedCapabilities = byAuthzDomain(definition.authzDomains, ALL_ACTIONS);
    const derivedResources = byAuthzDomain(definition.authzDomains, ALL_RESOURCES);
    return {
      moduleCode: definition.moduleCode,
      name: definition.name,
      description: definition.description,
      domain: definition.domain,
      status,
      availability: status !== 'not_released',
      reasons: reasonsFor(status, definition),
      featureFlag: definition.gatedModuleId ? FEATURE_FLAG_ENV[definition.gatedModuleId] : null,
      dependencies: definition.dependencies ?? [],
      capabilities: [...new Set([...derivedCapabilities, ...(definition.declaredCapabilities ?? [])])],
      resources: [...new Set([...derivedResources, ...(definition.declaredResources ?? [])])],
      routes: definition.routes,
    };
  });
}

export function buildModuleRegistrySummary(env: NodeJS.ProcessEnv = process.env): ModuleRegistrySummary[] {
  return buildModuleRegistry(MODULE_REGISTRY_DEFINITIONS, env).map((entry) => ({
    moduleCode: entry.moduleCode,
    name: entry.name,
    description: entry.description,
    domain: entry.domain,
    status: entry.status,
    availability: entry.availability,
    reasons: entry.reasons,
    dependencies: entry.dependencies,
  }));
}

export function findModuleRegistryEntry(
  moduleCode: string,
  env: NodeJS.ProcessEnv = process.env,
): ModuleRegistryDetail | undefined {
  return buildModuleRegistry(MODULE_REGISTRY_DEFINITIONS, env).find((entry) => entry.moduleCode === moduleCode);
}
