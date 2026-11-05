import { FEATURE_FLAG_ENV, type GatedModuleId } from './release-1-scope';

/**
 * POLÍTICA DE FEATURE FLAG DE SUPERFÍCIE — CISNE
 *
 * REGRA PRINCIPAL: a flag de build NÃO é boundary de segurança e NÃO substitui autorização.
 *
 * A fronteira de segurança do CISNE é o backend: `AuthorizationGuard` + PDP fail-closed
 * (`policy-decision-point.service.ts`) decidem, por identidade e escopo, o que cada ator pode
 * ler e escrever. Esconder uma rota no bundle é redução de superfície de UI — nunca controle
 * de acesso. Um ator sem grant que alcance a URL recebe 403 do servidor, com ou sem flag.
 *
 * Por que a flag existe então: para permitir que um artefato de release publique um recorte de
 * módulos SEM remover código do bundle, e para deixar explícito no build o que foi homologado.
 *
 * ---------------------------------------------------------------------------------------------
 * DEFAULT POR AMBIENTE
 * ---------------------------------------------------------------------------------------------
 *
 * - **dev / HML**: módulo CONSTRUÍDO entra LIGADO por padrão.
 *   Homologação existe para homologar o produto que foi construído. Um módulo com código,
 *   migrations, autorização e testes que fica desligado por um default de Dockerfile não é
 *   "release controlado" — é produto invisível. Este era o defeito real: o `ARG` default de
 *   `docker/hml/Dockerfile.web` era `false` para sete módulos já construídos, de modo que
 *   qualquer build sem `--env-file` produzia silenciosamente um produto mutilado.
 *
 * - **produção**: o recorte continua sendo decisão empresarial EXPLÍCITA.
 *   Em produção o default permanece conservador (desligado) e a decisão de ligar é declarada
 *   no env de produção, nunca herdada por omissão.
 *
 * Módulos que são apenas STUB (sem API real por trás) permanecem desligados em todos os
 * ambientes: `rentals` e `transport` têm `*-api.ts` de 8 linhas e não são produto construído.
 */

/**
 * Módulos cujo código existe e é auditável hoje: ligados por padrão em dev/HML.
 * Fonte: `apps/api/src` (controllers + serviços + autorização) e `apps/web/src` (páginas reais).
 */
export const BUILT_MODULES: ReadonlySet<GatedModuleId> = new Set<GatedModuleId>([
  'finance',
  'fiscal',
  'accounting',
  'inventory',
  'payroll',
  'procurement',
  'suppliers',
  'contracts',
  'people',
  'alerts',
  'reports',
  'approval-matrix',
  'operational-profitability',
]);

/**
 * Módulos que são apenas superfície sem backend real por trás (stub comprovado).
 * Permanecem desligados por padrão em TODOS os ambientes até serem produto.
 */
export const STUB_MODULES: ReadonlySet<GatedModuleId> = new Set<GatedModuleId>([
  'rentals',
  'transport',
]);

type FlagEnv = Record<string, string | undefined>;

function readViteEnv(): FlagEnv {
  return import.meta.env;
}

/**
 * Discriminador de superfície de entrega.
 *
 * ATENÇÃO DELIBERADA: o `Dockerfile.web` builda HML com `NODE_ENV=production`, então
 * `import.meta.env.PROD` é `true` também em HML — `PROD` NÃO distingue produção de
 * homologação. Por isso a decisão de ambiente depende de `VITE_CISNE_SURFACE`, declarado
 * explicitamente por ambiente no compose. Sem essa variável o default é conservador, para
 * que um bundle esquecido nunca publique módulo que não foi homologado.
 */
const SURFACE_ENV_KEY = 'VITE_CISNE_SURFACE';

/** Superfícies que homologam o produto construído inteiro. */
const HOMOLOGATION_SURFACES: ReadonlySet<string> = new Set(['dev', 'hml', 'homolog', 'sandbox']);

export type SurfaceResolution = {
  /** Valor efetivo da flag. */
  enabled: boolean;
  /** De onde veio a decisão — usado em diagnóstico e em teste. */
  origin: 'explicit-env' | 'surface-default' | 'conservative-default';
};

/**
 * Resolve uma flag de superfície, dizendo de onde veio a decisão.
 *
 * Ordem: (1) variável explícita do módulo vence sempre; (2) default da superfície declarada;
 * (3) default conservador (desligado).
 */
export function resolveModuleFlag(
  moduleId: GatedModuleId,
  env: FlagEnv = readViteEnv(),
): SurfaceResolution {
  const explicit = env[FEATURE_FLAG_ENV[moduleId]];
  if (explicit === 'true' || explicit === 'false') {
    return { enabled: explicit === 'true', origin: 'explicit-env' };
  }

  const surface = env[SURFACE_ENV_KEY]?.trim().toLowerCase();
  if (surface && HOMOLOGATION_SURFACES.has(surface) && BUILT_MODULES.has(moduleId)) {
    return { enabled: true, origin: 'surface-default' };
  }

  return { enabled: false, origin: 'conservative-default' };
}

/**
 * Módulo habilitado nesta build.
 *
 * Compatibilidade: mantém a assinatura usada por `useNavAccess` e `ReleaseScopeGate`.
 */
export function isReleaseModuleEnabled(
  moduleId: GatedModuleId,
  env: FlagEnv = readViteEnv(),
): boolean {
  return resolveModuleFlag(moduleId, env).enabled;
}
