import { useSyncExternalStore } from 'react';
import { PAYROLL_PERIOD_STATUS_LABELS, labelOrRaw } from '../../financial-ui/labels';
import type { HumanLookupOption } from '../../financial-ui/HumanLookupField';
import type { EmploymentContract, PayrollPeriod } from '../api/payroll-api';

/**
 * DIRETÓRIO HUMANO DA FOLHA — períodos e contratos já alcançados do servidor.
 *
 * Problema: a API de folha deste release endereça período por `periodId` (UUID) e contrato por
 * `employmentContractId` (UUID). Ela NÃO expõe `GET /payroll/periods?unitId=` nem
 * `GET /payroll/contracts`: as únicas listas possíveis hoje são as que o próprio operador já
 * alcançou do servidor. Sem elas, a única forma de chegar a um período era digitar o UUID.
 *
 * Este diretório é memória de NAVEGAÇÃO, não cadastro: cada entrada nasce exclusivamente de uma
 * resposta real da API (abrir/consultar/calcular/fechar/reabrir período, cadastrar contrato),
 * registrada na fronteira do cliente (`../api/payroll-api`). Nada é inventado aqui — competência,
 * status, unidade e datas são copiados do payload; payload fora da forma conhecida é descartado em
 * vez de virar opção fabricada.
 *
 * Limites declarados: a memória vale para a sessão do navegador (não é persistida em
 * localStorage/sessionStorage, para não gravar dado de negócio no browser) e é limitada às
 * entradas mais recentes. Quando a API ganhar listas por unidade, a busca passa a usá-las e este
 * diretório deixa de ser a fonte.
 */
export type KnownPayrollPeriod = {
  id: string;
  unitId: string;
  competenceYear: number;
  competenceMonth: number;
  status: string;
  startsOn: string;
  endsOn: string;
};

export type KnownEmploymentContract = {
  id: string;
  unitId: string;
  code: string;
  displayName: string;
  status: string;
  startsOn: string;
  endsOn: string | null;
};

/** Teto da memória de navegação: o suficiente para escolher, longe de virar "lista" paralela. */
const MAX_KNOWN_ENTRIES = 50;

let knownPeriods: KnownPayrollPeriod[] = [];
let knownContracts: KnownEmploymentContract[] = [];
let version = 0;
const listeners = new Set<() => void>();

function publish(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Versão do diretório. A tela usa como `key` dos campos de busca para que uma opção recém
 * registrada (período aberto, contrato cadastrado) apareça sem recarregar a página.
 */
export function usePayrollDirectoryVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}

function samePeriod(left: KnownPayrollPeriod, right: KnownPayrollPeriod): boolean {
  return (
    left.unitId === right.unitId &&
    left.competenceYear === right.competenceYear &&
    left.competenceMonth === right.competenceMonth &&
    left.status === right.status &&
    left.startsOn === right.startsOn &&
    left.endsOn === right.endsOn
  );
}

function sameContract(left: KnownEmploymentContract, right: KnownEmploymentContract): boolean {
  return (
    left.unitId === right.unitId &&
    left.code === right.code &&
    left.displayName === right.displayName &&
    left.status === right.status &&
    left.startsOn === right.startsOn &&
    left.endsOn === right.endsOn
  );
}

/** Registra um período devolvido pelo servidor. Payload incompleto é ignorado (não inventa competência). */
export function rememberPayrollPeriod(period: PayrollPeriod): void {
  const competenceYear = Number(period.competenceYear);
  const competenceMonth = Number(period.competenceMonth);
  if (
    !period.id ||
    !Number.isInteger(competenceYear) ||
    !Number.isInteger(competenceMonth) ||
    competenceMonth < 1 ||
    competenceMonth > 12
  ) {
    return;
  }
  const entry: KnownPayrollPeriod = {
    id: period.id,
    unitId: period.unitId ?? '',
    competenceYear,
    competenceMonth,
    status: period.status ?? '',
    startsOn: period.startsOn ?? '',
    endsOn: period.endsOn ?? '',
  };
  const existing = knownPeriods.find((known) => known.id === entry.id);
  if (existing && samePeriod(existing, entry)) {
    return;
  }
  knownPeriods = [entry, ...knownPeriods.filter((known) => known.id !== entry.id)].slice(
    0,
    MAX_KNOWN_ENTRIES,
  );
  publish();
}

/** Registra um contrato devolvido pelo servidor. Sem código e nome legíveis, não entra na busca. */
export function rememberEmploymentContract(contract: EmploymentContract): void {
  if (!contract?.id || !contract.code || !contract.displayName) {
    return;
  }
  const entry: KnownEmploymentContract = {
    id: contract.id,
    unitId: contract.unitId ?? '',
    code: contract.code,
    displayName: contract.displayName,
    status: contract.status ?? '',
    startsOn: contract.startsOn ?? '',
    endsOn: contract.endsOn ?? null,
  };
  const existing = knownContracts.find((known) => known.id === entry.id);
  if (existing && sameContract(existing, entry)) {
    return;
  }
  knownContracts = [entry, ...knownContracts.filter((known) => known.id !== entry.id)].slice(
    0,
    MAX_KNOWN_ENTRIES,
  );
  publish();
}

/** Competência no formato que o operador lê: MM/AAAA. */
export function formatPayrollCompetence(period: {
  competenceYear: number;
  competenceMonth: number;
}): string {
  return `${String(period.competenceMonth).padStart(2, '0')}/${period.competenceYear}`;
}

export function payrollPeriodStatusLabel(status: string): string {
  return labelOrRaw(status, PAYROLL_PERIOD_STATUS_LABELS);
}

/** Rótulo humano do período já conhecido (competência) ou null quando não foi alcançado nesta sessão. */
export function knownPayrollPeriodLabel(periodId: string): string | null {
  const entry = knownPeriods.find((known) => known.id === periodId);
  return entry ? formatPayrollCompetence(entry) : null;
}

/** Rótulo humano do contrato já conhecido (código — nome) ou null quando não foi alcançado. */
export function knownEmploymentContractLabel(employmentContractId: string): string | null {
  const entry = knownContracts.find((known) => known.id === employmentContractId);
  return entry ? `${entry.code} — ${entry.displayName}` : null;
}

export function knownPayrollPeriods(): KnownPayrollPeriod[] {
  return [...knownPeriods];
}

export function knownEmploymentContracts(): KnownEmploymentContract[] {
  return [...knownContracts];
}

function matchesTerm(haystack: string, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return haystack.includes(needle);
}

function periodHaystack(entry: KnownPayrollPeriod): string {
  const month = String(entry.competenceMonth).padStart(2, '0');
  return [
    formatPayrollCompetence(entry),
    `${entry.competenceYear}-${month}`,
    entry.status,
    payrollPeriodStatusLabel(entry.status),
    entry.unitId,
    entry.startsOn,
    entry.endsOn,
  ]
    .join(' ')
    .toLowerCase();
}

function contractHaystack(entry: KnownEmploymentContract): string {
  return [entry.code, entry.displayName, entry.status, entry.unitId, entry.startsOn, entry.endsOn ?? '']
    .join(' ')
    .toLowerCase();
}

/**
 * Opções humanas de período: competência + status no rótulo, unidade e vigência no apoio.
 * O identificador técnico permanece interno do componente de busca.
 */
export function searchPayrollPeriodOptions(term: string): HumanLookupOption[] {
  return knownPeriods
    .filter((entry) => matchesTerm(periodHaystack(entry), term))
    .map((entry) => ({
      id: entry.id,
      label: `${formatPayrollCompetence(entry)} — ${payrollPeriodStatusLabel(entry.status)}`,
      support: `unidade ${entry.unitId} · ${entry.startsOn} a ${entry.endsOn}`,
    }));
}

/** Opções humanas de contrato: código + nome no rótulo, unidade e vigência no apoio. */
export function searchEmploymentContractOptions(term: string): HumanLookupOption[] {
  return knownContracts
    .filter((entry) => matchesTerm(contractHaystack(entry), term))
    .map((entry) => ({
      id: entry.id,
      label: `${entry.code} — ${entry.displayName}`,
      support: [
        `unidade ${entry.unitId}`,
        `início ${entry.startsOn}`,
        entry.endsOn ? `fim ${entry.endsOn}` : 'sem data de fim',
        entry.status,
      ].join(' · '),
    }));
}

/** Uso exclusivo de teste: um caso não pode depender de memória deixada por outro. */
export function resetPayrollDirectory(): void {
  knownPeriods = [];
  knownContracts = [];
  publish();
}
