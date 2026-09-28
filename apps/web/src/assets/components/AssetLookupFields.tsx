import { useId, useMemo } from 'react';
import { HumanLookupField, type HumanLookupOption } from '../../financial-ui/HumanLookupField';
import { Field, FieldError, Input } from '../../ui';
import type { PhysicalResourceTypeOption } from '../types/physical-asset.types';

/**
 * ESCOLHA HUMANA DAS REFERÊNCIAS DO CADASTRO DE ATIVOS
 *
 * Tipo de recurso e unidade operacional são referências que a API endereça por identificador.
 * No cadastro antigo o tipo vinha de uma lista nativa longa e a unidade de um campo de TEXTO
 * LIVRE — o operador digitava (e errava) uma referência que ele não tem como conferir.
 *
 * Os dois passam agora pelo mesmo `HumanLookupField` do projeto. A fonte da busca é a lista JÁ
 * carregada e JÁ autorizada (o catálogo de tipos ativos e as unidades operacionais visíveis para
 * o ator), então não é criada nenhuma consulta nova de autorização: a busca apenas filtra em
 * memória por nome/código. Nenhuma regra de negócio muda — o valor entregue ao formulário
 * continua sendo exatamente o identificador que o payload espera.
 *
 * Quando a lista de unidades não está disponível (carregando, negada ou vazia), o campo NÃO
 * desaparece nem inventa opções: ele volta a aceitar a referência registrada digitada, com o
 * motivo declarado. É o mesmo recuo select→input já usado no builder do catálogo
 * (`ServiceDefinitionForm`), e evita que uma capability de outro domínio bloqueie o cadastro.
 */

function matchesTerm(option: HumanLookupOption, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  return `${option.label} ${option.support ?? ''}`.toLowerCase().includes(needle);
}

/**
 * Busca local sobre opções já carregadas. O `signal` é aceito porque o contrato do
 * `HumanLookupField` cancela buscas em andamento; sem rede, a resposta é imediata.
 */
function buildLocalSearch(
  options: HumanLookupOption[],
): (term: string, signal?: AbortSignal) => Promise<HumanLookupOption[]> {
  return (term, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) {
        resolve([]);
        return;
      }
      resolve(options.filter((option) => matchesTerm(option, term)));
    });
}

export function AssetResourceTypeField({
  value,
  onChange,
  options,
  loading,
  error,
  required,
}: {
  value: string;
  onChange: (resourceTypeId: string) => void;
  options: PhysicalResourceTypeOption[];
  loading: boolean;
  error?: string;
  required?: boolean;
}) {
  const fieldId = useId();
  const lookupOptions = useMemo<HumanLookupOption[]>(
    () =>
      options.map((type) => ({
        id: type.id,
        label: type.name,
        support: type.code,
      })),
    [options],
  );
  const search = useMemo(() => buildLocalSearch(lookupOptions), [lookupOptions]);
  const selected = options.find((type) => type.id === value);
  const loadingMessage = 'Carregando tipos de recurso do catálogo…';

  return (
    <div className="min-w-0">
      <HumanLookupField
        label="Tipo de recurso"
        htmlFor={fieldId}
        required={required}
        hint="Tipo ativo do catálogo de recursos."
        placeholder="Buscar por nome ou código"
        search={search}
        value={value}
        onChange={onChange}
        initialLabel={selected ? `${selected.name} (${selected.code})` : undefined}
        emptyMessage={
          loading ? loadingMessage : 'Nenhum tipo de recurso ativo encontrado no catálogo.'
        }
      />
      {error ? <FieldError className="mt-1">{error}</FieldError> : null}
    </div>
  );
}

export function AssetOperationalUnitField({
  value,
  onChange,
  units,
  unitsLoading,
  unitsUnavailable,
  error,
  required,
  disabled,
}: {
  value: string;
  onChange: (unitId: string) => void;
  units: string[];
  unitsLoading: boolean;
  unitsUnavailable: boolean;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const fieldId = useId();
  const lookupOptions = useMemo<HumanLookupOption[]>(
    () => units.map((unit) => ({ id: unit, label: unit })),
    [units],
  );
  const search = useMemo(() => buildLocalSearch(lookupOptions), [lookupOptions]);

  if (units.length === 0) {
    const hint = unitsLoading
      ? 'Carregando as unidades operacionais registradas…'
      : unitsUnavailable
        ? 'As unidades registradas não estão disponíveis para o seu acesso; informe a unidade que responde pelo ativo.'
        : 'Nenhuma unidade operacional registrada; informe a unidade que responde pelo ativo.';

    return (
      <Field
        label="Unidade operacional"
        htmlFor={fieldId}
        required={required}
        error={error}
        hint={hint}
      >
        <Input
          id={fieldId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          disabled={disabled || unitsLoading}
          invalid={Boolean(error)}
          autoComplete="off"
          spellCheck={false}
          placeholder="UN-DEV-001"
        />
      </Field>
    );
  }

  return (
    <div className="min-w-0">
      <HumanLookupField
        label="Unidade operacional"
        htmlFor={fieldId}
        required={required}
        hint="Unidade registrada que responde pelo ativo."
        placeholder="Buscar unidade"
        search={search}
        value={value}
        onChange={onChange}
        emptyMessage="Nenhuma unidade operacional registrada para o seu acesso."
      />
      {error ? <FieldError className="mt-1">{error}</FieldError> : null}
    </div>
  );
}
