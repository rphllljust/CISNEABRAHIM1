import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ScrollText } from 'lucide-react';
import { listClients } from '../../clients/api/clients-api';
import { ContractsApiError, createContract } from '../api/contracts-api';
import { mapContractErrorToMessage } from '../api/contracts-error-messages';
import { ContractFormFields, type ClientOption } from '../components/ContractFormFields';
import { useContractCapabilities } from '../hooks/useContractCapabilities';
import { formatDate } from '../utils/contract-status-labels';
import { BuilderSection, Button, FieldError, StickyActionBar } from '../../ui';
import {
  ModuleDeniedState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
} from '../../ui/module-layout';
import {
  buildCreateContractPayload,
  EMPTY_CONTRACT_FORM,
  validateContractCreateForm,
} from '../utils/contract-form-values';

const CREATE_DESCRIPTION =
  'Cadastre o contrato comercial com o Cliente, a vigência e as condições de pagamento.';

/** Link de cancelamento com a mesma linguagem do botão secundário (sem biblioteca nova). */
const SECONDARY_LINK_CLASS =
  'inline-flex min-h-9 items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 no-underline ring-1 ring-gray-300 ring-inset hover:bg-gray-50';

/**
 * ETIQUETA DE OBRIGATORIEDADE — o asterisco do `Field` diz QUE o campo e obrigatorio, nao
 * QUANTOS nem QUAIS. A faixa declara o conjunto de uma vez, para o operador saber o custo real
 * do cadastro antes de digitar. Texto acessivel (nao e so cor nem so asterisco) e nunca
 * substitui a marcacao por campo.
 */
function RequiredLegend({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 text-[11px] font-medium text-gray-500">
      <span className="text-error-fg" aria-hidden="true">
        *
      </span>{' '}
      {children}
    </p>
  );
}

/**
 * NOVO CONTRATO — cadastro no padrao empresarial do CISNE.
 *
 * Antes: `ModulePageHeader` com paragrafo + `BuilderSummary` como faixa SOLTA e um unico
 * `BuilderSection` com dez campos em grade continua.
 *
 * O resumo solto tinha um defeito visivel: `currencyCode` nasce `'BRL'` em `EMPTY_CONTRACT_FORM`
 * e o `BuilderSummary` remove valores vazios, entao no formulario em branco sobrava a pilula
 * "MOEDA BRL" flutuando acima do cartao — o unico item "preenchido" era justamente o unico que
 * o operador nao escolheu. Aqui o resumo passa a viver DENTRO do painel de identificacao, com
 * travessao para o que ainda nao foi preenchido e SEM a moeda (padrao, nao decisao do operador),
 * e o Cliente aparece pelo NOME escolhido — nunca pelo identificador tecnico.
 *
 * Os campos passam a ser agrupados em secoes semanticas por `ContractFormFields` (identificacao,
 * escopo, vigencia e moeda, condicoes de pagamento), compartilhadas com a pagina de edicao.
 *
 * NADA da regra mudou: `createContract`, `validateContractCreateForm`,
 * `buildCreateContractPayload`, o carregamento de clientes, o estado de submissao, o bloqueio
 * por capability e o redirecionamento pos-cadastro permanecem iguais. Os rotulos acessiveis de
 * todos os campos continuam identicos (o e2e depende deles).
 */
export function ContractsCreatePage() {
  const navigate = useNavigate();
  const [urlParams] = useSearchParams();
  const { capabilities, loading: capabilitiesLoading } = useContractCapabilities();
  /**
   * CONTEXTO RECEBIDO DA OBJECT PAGE DO CLIENTE.
   *
   * Chegando por `/app/contracts/new?clientId=…` o cliente já vem escolhido e o operador não
   * precisa procurá-lo outra vez. É apenas o valor INICIAL do formulário — o backend continua
   * validando existência, autorização, escopo e elegibilidade do cliente no POST.
   */
  const contextClientId = urlParams.get('clientId')?.trim() ?? '';
  const [values, setValues] = useState(() =>
    contextClientId ? { ...EMPTY_CONTRACT_FORM, clientId: contextClientId } : { ...EMPTY_CONTRACT_FORM },
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void listClients({ limit: 100, offset: 0 }, controller.signal)
      .then((response) => {
        setClients(
          response.items.map((client) => ({
            id: client.id,
            label: client.tradeName || client.legalName,
          })),
        );
      })
      .catch(() => setClients([]))
      .finally(() => {
        if (!controller.signal.aborted) {
          setClientsLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  if (capabilitiesLoading) {
    return (
      <ModulePage>
        <ModulePageHeader title="Novo contrato" description={CREATE_DESCRIPTION} />
        <ModuleLoadingState title="Novo contrato" message="Verificando permissões…" />
      </ModulePage>
    );
  }

  if (!capabilities.canCreate) {
    return (
      <ModulePage>
        <ModulePageHeader title="Novo contrato" description={CREATE_DESCRIPTION} />
        <ModuleDeniedState
          title="Novo contrato"
          message="Você não tem permissão para cadastrar contratos."
        />
        <p className="mt-3 mb-0">
          <Link to="/app/contracts" className={SECONDARY_LINK_CLASS}>
            Voltar à lista
          </Link>
        </p>
      </ModulePage>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const errors = validateContractCreateForm(values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      const created = await createContract(buildCreateContractPayload(values));
      void navigate(`/app/contracts/${created.contract.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ContractsApiError) {
        setSubmitError(mapContractErrorToMessage(error.code, error.status));
      } else {
        setSubmitError('Não foi possível cadastrar o contrato.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const selectedClient = clients.find((client) => client.id === values.clientId);

  return (
    <ModulePage>
      <ModulePageHeader title="Novo contrato" />
      <form
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        className="flex flex-col gap-3"
        aria-describedby={submitError ? 'contract-create-error' : undefined}
      >
        {submitError ? (
          <div className="mb-1">
            <FieldError id="contract-create-error">{submitError}</FieldError>
          </div>
        ) : null}

        {/*
          PAINEL DE IDENTIFICACAO — titulo, obrigatoriedade e resumo dividem UMA moldura.

          ATENCAO ao nome do `<h2>`: a pagina ja tem `<h1>Novo contrato</h1>` e o e2e resolve o
          titulo por `getByRole('heading', { name: /^novo contrato$/i })`, que exige UM unico no.
          Repetir "Novo contrato" aqui quebraria a prova — o painel nomeia a ATIVIDADE
          ("Novo cadastro"), o `<h1>` nomeia a tela.
        */}
        <section
          aria-labelledby="contract-create-panel-heading"
          className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-3">
            <div className="flex min-w-0 items-start gap-3">
              <span
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700 ring-1 ring-brand-200 ring-inset"
                aria-hidden="true"
              >
                <ScrollText className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h2
                  id="contract-create-panel-heading"
                  className="m-0 text-sm font-semibold text-gray-900"
                >
                  Novo cadastro
                </h2>
                <p className="m-0 mt-0.5 max-w-2xl text-xs text-gray-500">{CREATE_DESCRIPTION}</p>
              </div>
            </div>
            <RequiredLegend>Número, título, cliente, unidade e vigência inicial.</RequiredLegend>
          </div>

          {/*
            RESUMO DA PROPRIA EDICAO, no rodape do painel. Sem a moeda (valor padrao, nao escolha
            do operador) e com travessao no que falta — assim o formulario em branco le como
            estado vazio intencional, e nao como uma pilula solta de "MOEDA BRL".
          */}
          <dl
            aria-label="Resumo do cadastro em andamento"
            className="m-0 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-b-lg border-t border-slate-100 bg-slate-50/70 px-4 py-2.5"
          >
            {[
              { label: 'Número', value: values.contractNumber.trim() },
              { label: 'Título', value: values.title.trim() },
              { label: 'Cliente', value: selectedClient?.label ?? '' },
              {
                label: 'Vigência inicial',
                value: values.validFrom ? formatDate(values.validFrom) : '',
              },
            ].map((item) => (
              <div key={item.label} className="flex min-w-0 items-baseline gap-1.5">
                <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                  {item.label}
                </dt>
                <dd
                  className={
                    item.value
                      ? 'm-0 max-w-[16rem] truncate text-sm font-semibold text-gray-900 tabular-nums'
                      : 'm-0 text-sm font-medium text-gray-400'
                  }
                >
                  {item.value || '—'}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <BuilderSection
          title="Dados do contrato"
          description="Cliente, unidade, identificação comercial, escopo e vigência desta versão."
        >
          <ContractFormFields
            mode="create"
            values={values}
            clients={clients}
            clientsLoading={clientsLoading}
            disabled={submitting}
            fieldErrors={fieldErrors}
            onChange={setValues}
          />
        </BuilderSection>

        <StickyActionBar
          className="!static"
          note="Somente o número, o título, o cliente e a vigência inicial são obrigatórios."
        >
          <Link to="/app/contracts" className={SECONDARY_LINK_CLASS}>
            Cancelar
          </Link>
          <Button
            type="submit"
            disabled={submitting}
            loading={submitting}
            loadingText="Cadastrando"
          >
            Cadastrar contrato
          </Button>
        </StickyActionBar>

      </form>
    </ModulePage>
  );
}
