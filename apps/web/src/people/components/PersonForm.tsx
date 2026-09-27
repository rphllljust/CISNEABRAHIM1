import { useId, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import {
  BuilderSection,
  BuilderSummary,
  Button,
  Field,
  Input,
  Select,
  StickyActionBar,
} from '../../ui';
import { PERSON_STATUSES, type Person, type PersonStatus } from '../types/person.types';

/**
 * FORMULÁRIO DE PESSOA — cadastro e edição no contrato estruturado do CISNE.
 *
 * O vínculo com o catálogo (função operacional padrão) e a referência externa são fatos
 * empresariais da pessoa, não campos soltos de um formulário: por isso a tela tem IDENTIFICAÇÃO,
 * VÍNCULO e — na edição — a SITUAÇÃO persistida do cadastro. O que a pessoa NÃO tem hoje é
 * linha repetida (documentos, contatos, endereços): o contrato da API não os carrega, então
 * nenhuma coleção é inventada aqui.
 *
 * Regras, validações e payload permanecem nos chamadores (`PersonCreatePage` /
 * `PersonEditPage`) exatamente como estavam.
 */

const STATUS_LABELS: Record<PersonStatus, string> = {
  [PERSON_STATUSES.Active]: 'Ativa',
  [PERSON_STATUSES.Inactive]: 'Inativa',
};

/** Link de cancelamento com a mesma linguagem do botão secundário (sem biblioteca nova). */
const SECONDARY_LINK_CLASS =
  'inline-flex min-h-[var(--spacing-touch)] items-center justify-center rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 no-underline ring-1 ring-inset ring-gray-300 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';

export type PersonFormValues = {
  legalName: string;
  preferredName: string;
  defaultLaborTypeCode: string;
  externalErpId: string;
};

export type PersonFormProps = {
  mode: 'create' | 'edit';
  values: PersonFormValues;
  laborTypes: Array<{ code: string; name: string }>;
  /** Erro inline do campo obrigatório (nome legal). */
  legalNameError?: string | null;
  submitError?: string | null;
  submitting: boolean;
  /** Pessoa persistida — presente apenas na edição. Alimenta o resumo e os fatos do cadastro. */
  person?: Person | null;
  onChange: (patch: Partial<PersonFormValues>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  cancelHref: string;
};

function formatDateTime(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return new Date(value).toLocaleString('pt-BR');
}

export function PersonForm({
  mode,
  values,
  laborTypes,
  legalNameError = null,
  submitError = null,
  submitting,
  person = null,
  onChange,
  onSubmit,
  cancelHref,
}: PersonFormProps) {
  const formErrorId = useId();
  const legalNameId = useId();
  const preferredNameId = useId();
  const laborTypeId = useId();
  const externalErpIdId = useId();
  const isEdit = mode === 'edit';
  const selectedLaborType = laborTypes.find((item) => item.code === values.defaultLaborTypeCode);
  const laborTypeLabel =
    selectedLaborType?.name ?? person?.defaultLaborTypeName ?? values.defaultLaborTypeCode ?? null;

  // Fato sem dado real é OMITIDO — nunca uma linha vazia que finge completude.
  const recordFacts = person
    ? [
        { label: 'Código da pessoa', value: person.memberCode },
        { label: 'Situação', value: STATUS_LABELS[person.status] },
        { label: 'Criada em', value: formatDateTime(person.createdAt) },
        { label: 'Atualizada em', value: formatDateTime(person.updatedAt) },
      ].filter((fact) => fact.value !== null && fact.value !== '')
    : [];

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-3"
      aria-describedby={submitError ? formErrorId : undefined}
    >
      {submitError ? (
        <p
          id={formErrorId}
          role="alert"
          className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
        >
          {submitError}
        </p>
      ) : null}

      <BuilderSummary
        items={[
          { label: 'Nome legal', value: values.legalName.trim() || null },
          { label: 'Nome de uso', value: values.preferredName.trim() || null },
          { label: 'Função operacional', value: laborTypeLabel || null },
          { label: 'Referência externa', value: values.externalErpId.trim() || null },
          { label: 'Situação', value: person ? STATUS_LABELS[person.status] : null },
        ]}
      />

      <fieldset
        disabled={submitting}
        className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
        aria-label="Dados da pessoa"
      >
        <BuilderSection
          title="Identificação"
          description="Nome legal (obrigatório no cadastro) e nome pelo qual a pessoa é chamada."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Nome legal"
              htmlFor={legalNameId}
              required
              error={legalNameError ?? undefined}
            >
              <Input
                id={legalNameId}
                value={values.legalName}
                onChange={(event) => onChange({ legalName: event.target.value })}
                required
                invalid={Boolean(legalNameError)}
                disabled={submitting}
              />
            </Field>
            <Field label="Nome de uso" htmlFor={preferredNameId}>
              <Input
                id={preferredNameId}
                value={values.preferredName}
                onChange={(event) => onChange({ preferredName: event.target.value })}
                disabled={submitting}
              />
            </Field>
          </div>
        </BuilderSection>

        <BuilderSection
          title="Vínculo"
          description="Função operacional padrão exercida pela pessoa e referência do cadastro no ERP."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Função operacional padrão"
              htmlFor={laborTypeId}
              hint={
                laborTypes.length === 0
                  ? 'Nenhuma função operacional disponível no catálogo.'
                  : undefined
              }
            >
              <Select
                id={laborTypeId}
                value={values.defaultLaborTypeCode}
                onChange={(event) => onChange({ defaultLaborTypeCode: event.target.value })}
                disabled={submitting}
              >
                <option value="">Sem função padrão</option>
                {values.defaultLaborTypeCode !== '' && !selectedLaborType ? (
                  <option value={values.defaultLaborTypeCode}>
                    {person?.defaultLaborTypeName ?? values.defaultLaborTypeCode}
                  </option>
                ) : null}
                {laborTypes.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Referência externa (opcional)" htmlFor={externalErpIdId}>
              <Input
                id={externalErpIdId}
                value={values.externalErpId}
                onChange={(event) => onChange({ externalErpId: event.target.value })}
                disabled={submitting}
              />
            </Field>
          </div>
        </BuilderSection>

        {recordFacts.length > 0 ? (
          <BuilderSection
            title="Situação do cadastro"
            description="Fatos persistidos da pessoa; a inativação é uma ação do detalhe, não deste formulário."
          >
            <DefinitionList items={recordFacts} />
          </BuilderSection>
        ) : null}
      </fieldset>

      <StickyActionBar
        note={
          isEdit
            ? 'Salva a versão atual do cadastro; alterações concorrentes são recusadas pelo servidor.'
            : 'Somente o nome legal é obrigatório; função padrão e referência podem ficar vazias.'
        }
      >
        <Link to={cancelHref} className={SECONDARY_LINK_CLASS}>
          Cancelar
        </Link>
        <Button type="submit" loading={submitting} loadingText="Salvando…">
          {isEdit ? 'Salvar alterações' : 'Cadastrar'}
        </Button>
      </StickyActionBar>
    </form>
  );
}
