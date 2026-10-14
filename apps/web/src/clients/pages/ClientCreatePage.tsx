import { Link, useNavigate } from 'react-router-dom';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Building2 } from 'lucide-react';
import { ClientsApiError, createClient } from '../api/clients-api';
import { mapClientErrorToMessage } from '../api/client-error-messages';
import { useClientCapabilities } from '../hooks/useClientCapabilities';
import { useClientDuplicateCheck } from '../hooks/useClientDuplicateCheck';
import { DuplicateWarning } from '../components/DuplicateWarning';
import { maskCnpjInput } from '../utils/format-cnpj';
import {
  buildCreatePayload,
  validateCreateClientForm,
  type ClientFormFieldErrors,
} from '../utils/client-form-validation';
import { BuilderSection, Button, Field, Input, StickyActionBar } from '../../ui';
import {
  ModulePage,
  ModulePageHeader,
  ModuleStatePage,
  ModuleLoadingState,
  ModuleDeniedState,
} from '../../ui/module-layout';

/**
 * Link de cancelamento com a mesma linguagem do botao secundario — padrao ja usado por
 * `PersonForm` e `PurchaseOrderForm`. Sem biblioteca nova.
 */
const SECONDARY_LINK_CLASS =
  'inline-flex min-h-[var(--spacing-touch)] items-center justify-center rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 no-underline ring-1 ring-inset ring-gray-300 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';

/**
 * ETIQUETA DE OBRIGATORIEDADE — o asterisco do `Field` diz QUE o campo e obrigatorio, nao
 * QUANTOS nem QUAIS. A faixa de identificacao declara o conjunto de uma vez, para o operador
 * saber o custo real do cadastro antes de comecar a digitar. O texto e acessivel (nao e so cor,
 * nem so asterisco) e nunca substitui a marcacao por campo.
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
 * NOVO CLIENTE — cadastro de pessoa juridica no padrao empresarial do CISNE.
 *
 * Antes: `ModulePageHeader` (bloco de titulo solto) seguido de `BuilderSummary` com quatro
 * pares em linha, duas `BuilderSection` e a barra de acao. A tela funcionava, mas abria com
 * MUITO espaco morto: o resumo em `dl` flex ocupava a largura toda para quatro rotulos, o
 * titulo ficava isolado sobre o fundo da aplicacao e o formulario nao se lia como uma peca
 * unica de cadastro.
 *
 * Agora: o titulo, a declaracao de obrigatoriedade e o resumo vivem no MESMO painel de
 * identificacao (moldura `rounded-lg border bg-white`), com o `BuilderSummary` preservado como
 * faixa inferior do painel. As duas secoes seguem em `BuilderSection` — o primitivo de edicao
 * estruturada do CISNE — e a acao principal continua na `StickyActionBar`.
 *
 * NADA da regra mudou: `createClient`, `validateCreateClientForm`, `buildCreatePayload`,
 * `maskCnpjInput`, `mapClientErrorToMessage`, o estado de submissao, o bloqueio por capability
 * e o redirecionamento pos-cadastro permanecem byte a byte iguais. `useClientCapabilities`,
 * `ClientsApiError` e o contrato de acessibilidade (rotulos, `<h1>`, `role="alert"`,
 * `aria-describedby`) continuam identicos.
 */
export function ClientCreatePage() {
  const navigate = useNavigate();
  const { capabilities, loading: capabilitiesLoading } = useClientCapabilities();
  const legalNameId = useId();
  const tradeNameId = useId();
  const taxIdId = useId();
  const externalErpIdId = useId();
  const contactNameId = useId();
  const contactEmailId = useId();
  const contactPhoneId = useId();
  const formErrorId = useId();

  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [externalErpId, setExternalErpId] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ClientFormFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * DUPLICIDADE — consulta o SERVIDOR enquanto o operador digita.
   *
   * Ligada APENAS aqui, na criação: editar um Cliente existente acusaria duplicidade contra ele
   * mesmo. A classificação (prova x suspeita) vem do servidor; esta tela só decide o que fazer com
   * ela — bloquear com prova, avisar com suspeita, e nunca fundir.
   */
  const duplicates = useClientDuplicateCheck({
    legalName,
    tradeName,
    taxId,
    externalErpId,
    enabled: true,
  });

  /*
   * BLOQUEIO POR DUPLICIDADE PROVADA.
   *
   * `duplicates.blocking` só é verdadeiro com coincidência de DOCUMENTO ou de REFERÊNCIA EXTERNA.
   * Suspeita por nome não bloqueia: empresas distintas podem ter o mesmo nome, e bloquear por
   * semelhança ensinaria o operador a contornar o aviso. O servidor continua barrando o CNPJ
   * idêntico no INSERT (409) como segunda barreira.
   */
  const blockedByDuplicate = duplicates.blocking;

  if (capabilitiesLoading) {
    return (
      <ModuleStatePage title="Novo Cliente">
        <ModuleLoadingState message="Verificando permissões para cadastrar Clientes…" />
      </ModuleStatePage>
    );
  }

  if (!capabilities.canCreate) {
    return (
      <ModuleStatePage title="Novo Cliente">
        <ModuleDeniedState message="Você não tem permissão para cadastrar Clientes." />
      </ModuleStatePage>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    /*
     * SEGUNDA BARREIRA NO CLIENTE, ANTES DA REQUISIÇÃO.
     *
     * O bloqueio já desabilita o botão, mas o submit pode ser disparado por Enter no formulário.
     * Recusar aqui evita uma requisição que o servidor recusaria de qualquer forma — e deixa claro
     * ao operador POR QUE o cadastro não seguiu, em vez de um 409 genérico.
     */
    if (blockedByDuplicate) {
      setSubmitError(
        'Há um Cliente com o mesmo documento. Abra o cadastro existente em vez de criar um novo.',
      );
      return;
    }

    const errors = validateCreateClientForm({
      legalName,
      taxId,
      contactName,
      contactEmail,
      contactPhone,
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      const created = await createClient(
        buildCreatePayload({
          legalName,
          tradeName,
          taxId,
          externalErpId,
          contactName,
          contactEmail,
          contactPhone,
        }),
      );
      void navigate(`/app/clients/${created.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ClientsApiError) {
        setSubmitError(mapClientErrorToMessage(error.code, error.status));
      } else {
        setSubmitError('Não foi possível cadastrar o Cliente.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModulePage>
      {/*
        NOVO CLIENTE — WORKFLOW GOVERNADO, NÃO FORMULÁRIO ESPALHADO.

        MEDIDO antes desta recomposição em 1600×900: os campos atravessavam a largura inteira da
        área de conteúdo (~1350px) em duas colunas gigantes, o aviso de duplicidade empilhava em
        cima do formulário, a ação ficava no fim de uma faixa longa, e o resultado era 208px de
        vazio abaixo do conteúdo — a tela lia como um formulário cru, não como um passo de
        cadastro empresarial.

        Agora: largura GOVERN Ada (~48rem para o formulário) e coluna de APOIO à direita com a
        checagem de duplicidade e o resumo do que está sendo criado. A ação principal fica na
        barra aderente, sempre alcançável.
      */}
      <ModulePageHeader title="Novo Cliente" />

      <form
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        className="grid items-start gap-x-6 gap-y-3 xl:grid-cols-[minmax(0,48rem)_minmax(0,20rem)]"
        aria-describedby={submitError ? formErrorId : undefined}
      >
        {/*
          COLUNA PRINCIPAL — o cadastro em si. Largura controlada, e não a tela inteira: campos
          que atravessam 1350px obrigam o olho a varrer demais entre rótulo e valor.
        */}
        <div className="flex min-w-0 flex-col gap-3">
        {submitError ? (
          <p
            id={formErrorId}
            role="alert"
            className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
          >
            {submitError}
          </p>
        ) : null}

        {/*
          PAINEL DE IDENTIFICACAO — antes este bloco era um `ModulePageHeader` solto sobre o
          fundo da aplicacao mais um `BuilderSummary` em faixa separada. Os dois descrevem a
          MESMA coisa (o que esta sendo cadastrado e do que ele precisa), entao passam a dividir
          uma moldura unica: cabecalho do painel em cima, resumo da propria edicao no rodape,
          separados por uma borda. Ganha hierarquia sem criar cartao decorativo.

          O titulo do painel e "Novo cadastro" DE PROPOSITO: a primeira secao do formulario ja
          se chama "Identificacao juridica". Repetir o mesmo `<h2>` duas vezes na mesma tela foi
          um DEFEITO INTRODUZIDO na primeira versao desta recomposicao — encontrado na captura
          renderizada, nao por leitura do codigo. O painel nomeia a ATIVIDADE (cadastrar); a
          secao nomeia o BLOCO DE DADOS.
        */}
        <section
          aria-labelledby="client-create-panel-heading"
          className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-3">
            <div className="flex min-w-0 items-start gap-3">
              <span
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700 ring-1 ring-brand-200 ring-inset"
                aria-hidden="true"
              >
                <Building2 className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h2
                  id="client-create-panel-heading"
                  className="m-0 text-sm font-semibold text-gray-900"
                >
                  Novo cadastro
                </h2>
                <p className="m-0 mt-0.5 max-w-2xl text-xs text-gray-500">
                  Cadastro de pessoa jurídica com CNPJ e contato operacional obrigatório.
                </p>
              </div>
            </div>
            <RequiredLegend>
              Razão social, CNPJ e nome do contato; informe e-mail ou telefone.
            </RequiredLegend>
          </div>

          {/*
            RESUMO DA PROPRIA EDICAO: o operador confere o que ja preencheu sem reler o
            formulario inteiro. Mesmo estado dos demais cadastros do CISNE (`PersonForm`,
            `PurchaseOrderForm`) — a diferenca aqui e so a moldura, que agora fecha o painel.
          */}
          <dl
            aria-label="Resumo do cadastro em andamento"
            className="m-0 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-b-lg border-t border-slate-100 bg-slate-50/70 px-4 py-2.5"
          >
            {[
              { label: 'Razão social', value: legalName.trim() },
              { label: 'Nome fantasia', value: tradeName.trim() },
              { label: 'CNPJ', value: taxId.trim() },
              { label: 'Contato', value: contactName.trim() },
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

        <fieldset
          disabled={submitting}
          className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
          aria-label="Dados do cliente"
        >
          {/*
            DUAS COLUNAS NO DESKTOP. Antes eram campos `full-width` empilhados um por linha:
            em 1440px cada input atravessava a tela inteira, a hierarquia sumia e o formulario
            nao cabia na primeira dobra. Razao social e nome fantasia sao fatos irmaos e dividem
            a linha; CNPJ e referencia externa dividem a seguinte.

            ALINHAMENTO DO PAR — `hint` POR CAMPO QUEBRAVA A LINHA. MEDIDO no DOM real
            (1440x900): com o hint no campo de referencia externa, esse controle saia em y=507 e
            o CNPJ ao lado em y=481 — 38px de desalinhamento entre dois campos que o operador le
            como par (a grade registrava 5 topos distintos onde deveria ter 4). O primitivo
            `Field` empilha rotulo + hint + controle, entao so a celula com hint crescia.
            A instrucao da referencia externa passou para a descricao da SECAO, valendo para o
            grupo e sem desalinhar o par. Mesmo padrao ja aplicado em Contratos e Pessoas.
          */}
          <BuilderSection
            title="Identificação jurídica"
            description="Razão social e CNPJ identificam a pessoa jurídica no ERP. A referência externa é o identificador deste cliente em outro sistema, quando existir."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Razão social"
                htmlFor={legalNameId}
                required
                error={fieldErrors.legalName ?? undefined}
              >
                <Input
                  id={legalNameId}
                  value={legalName}
                  onChange={(event) => setLegalName(event.target.value)}
                  required
                  invalid={Boolean(fieldErrors.legalName)}
                  disabled={submitting}
                />
              </Field>
              <Field label="Nome fantasia (opcional)" htmlFor={tradeNameId}>
                <Input
                  id={tradeNameId}
                  value={tradeName}
                  onChange={(event) => setTradeName(event.target.value)}
                  disabled={submitting}
                />
              </Field>
              <Field label="CNPJ" htmlFor={taxIdId} required error={fieldErrors.taxId ?? undefined}>
                <Input
                  id={taxIdId}
                  inputMode="numeric"
                  autoComplete="off"
                  value={taxId}
                  onChange={(event) => setTaxId(maskCnpjInput(event.target.value))}
                  required
                  invalid={Boolean(fieldErrors.taxId)}
                  disabled={submitting}
                />
              </Field>
              <Field label="Referência externa (opcional)" htmlFor={externalErpIdId}>
                <Input
                  id={externalErpIdId}
                  value={externalErpId}
                  onChange={(event) => setExternalErpId(event.target.value)}
                  disabled={submitting}
                />
              </Field>
            </div>
          </BuilderSection>

          <BuilderSection
            title="Contato operacional"
            description="Quem a operação procura para tratar pedidos, medições e cobrança."
            footer={
              fieldErrors.operationalContact ? (
                <p className="m-0 text-xs text-red-700" role="alert">
                  {fieldErrors.operationalContact}
                </p>
              ) : (
                <p className="m-0 text-xs text-gray-500">
                  Informe pelo menos e-mail ou telefone utilizável.
                </p>
              )
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome do contato" htmlFor={contactNameId} required>
                <Input
                  id={contactNameId}
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  required
                  disabled={submitting}
                />
              </Field>
              <Field label="E-mail" htmlFor={contactEmailId}>
                <Input
                  id={contactEmailId}
                  type="email"
                  autoComplete="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  disabled={submitting}
                />
              </Field>
              <Field label="Telefone" htmlFor={contactPhoneId}>
                <Input
                  id={contactPhoneId}
                  type="tel"
                  autoComplete="tel"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  disabled={submitting}
                />
              </Field>
            </div>
          </BuilderSection>
        </fieldset>

        {/* ACTION BAR: a acao principal fecha o formulario sem sobrepor os ultimos campos. */}
        <StickyActionBar
          className="!static"
          note={
            blockedByDuplicate
              ? 'Cadastro bloqueado: há um Cliente com o mesmo documento. Abra o cadastro existente.'
              : 'Somente razão social, CNPJ e nome do contato são obrigatórios; informe e-mail ou telefone.'
          }
        >
          <Link to="/app/clients" className={SECONDARY_LINK_CLASS}>
            Cancelar
          </Link>
          {/*
            BLOQUEIO POR DOCUMENTO COINCIDENTE DESABILITA O COMANDO PRIMÁRIO.
            O botão continua VISÍVEL (em vez de sumir) para que o operador entenda que a ação
            existe e está impedida — um botão que desaparece faria parecer defeito da tela.
          */}
          <Button
            type="submit"
            loading={submitting}
            loadingText="Salvando…"
            disabled={blockedByDuplicate}
          >
            Cadastrar Cliente
          </Button>
        </StickyActionBar>
        </div>

        {/*
          COLUNA DE APOIO — A CHECAGEM E O QUE ESTÁ SENDO CRIADO.

          A verificação de duplicidade é CONTEXTO DA CRIAÇÃO, não um toast que aparece e some:
          ela vive aqui, estável, enquanto o operador preenche. É também o lugar natural para o
          resumo do que já foi digitado — antes esse resumo estava no rodapé do painel de
          identificação, longe do formulário e sem função clara.

          A coluna não é decorativa: quando a checagem está ociosa ela DIZ que está ociosa, e
          quando acha algo ela é o ponto focal da tela.
        */}
        <aside className="flex min-w-0 flex-col gap-3" data-region="create-support">
          <section className="cisne-panel px-3 py-2.5">
            <h2 className="cisne-meta-label m-0">Verificação de cadastro</h2>
            <div className="mt-1.5">
              <DuplicateWarning state={duplicates} canRead={capabilities.canRead} />
            </div>
          </section>

          <section className="cisne-panel px-3 py-2.5">
            <h2 className="cisne-meta-label m-0">Em andamento</h2>
            <dl className="m-0 mt-1.5 flex flex-col gap-1">
              {[
                { label: 'Razão social', value: legalName.trim() },
                { label: 'Nome fantasia', value: tradeName.trim() },
                { label: 'CNPJ', value: taxId.trim() },
                { label: 'Contato', value: contactName.trim() },
              ].map((item) => (
                <div key={item.label} className="flex min-w-0 flex-col">
                  <dt className="cisne-meta-label">{item.label}</dt>
                  <dd
                    className={
                      item.value
                        ? 'cisne-type-meta m-0 min-w-0 truncate tabular-nums'
                        : 'cisne-type-helper m-0'
                    }
                  >
                    {item.value || 'não informado'}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </form>
    </ModulePage>
  );
}
