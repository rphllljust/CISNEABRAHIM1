import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AccessAdminApiError,
  createOrganizationalUnit,
  getOrganizationalUnitHistory,
  listOrganizationalUnits,
  updateOrganizationalUnit,
  type OperationalUnitDirectory,
  type OperationalUnitHistory,
} from '../api/access-admin-api';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: OperationalUnitDirectory };

function errorText(error: unknown): string {
  if (error instanceof AccessAdminApiError) {
    if (error.status === 403) return 'Acesso negado pelo servidor para esta operação.';
    if (error.status === 409) return 'Conflito de versão, código ou idempotência. Atualize a unidade e revise a operação.';
    if (error.status === 400) return 'Dados empresariais inválidos. Confira código, nome e versão.';
    if (error.status === 0) return 'Rede indisponível. A gravação não foi presumida; reenviar conserva a mesma chave.';
  }
  return 'Não foi possível concluir a operação. O estado não foi presumido.';
}

/**
 * UNIT master workbench inside Access Administration. This is not an isolated
 * CRUD: the work queue shows authorized business identities; the active object
 * exposes optimistic version, permission and immutable change history; commands
 * are server-authorized and idempotent. Unconfigured legacy anchors are
 * exceptions to resolve, never invented names or hidden UUIDs on operational UI.
 */
export function OperationalUnitsTab() {
  const [loaded, setLoaded] = useState<LoadState>({ phase: 'loading' });
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const [refId, setRefId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [history, setHistory] = useState<
    { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; value: OperationalUnitHistory }
  >({ phase: 'loading' });
  const retryCommand = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded({ phase: 'loading' });
    void listOrganizationalUnits(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setLoaded({ phase: 'ready', data });
          setSelectedId((current) =>
            data.items.some((item) => item.id === current) ? current : (data.items[0]?.id ?? ''),
          );
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ phase: 'error', message: errorText(error) });
      });
    return () => controller.abort();
  }, [revision]);

  const data = loaded.phase === 'ready' ? loaded.data : null;
  const active = data?.items.find((item) => item.id === selectedId);

  useEffect(() => {
    if (creating) return;
    setCode(active?.code ?? '');
    setName(active?.name ?? '');
  }, [active?.code, active?.id, active?.name, active?.version, creating]);

  useEffect(() => {
    if (!selectedId || creating || !active) return;
    const controller = new AbortController();
    setHistory({ phase: 'loading' });
    void getOrganizationalUnitHistory(selectedId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setHistory({ phase: 'ready', value });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setHistory({ phase: 'error', message: errorText(error) });
      });
    return () => controller.abort();
  }, [selectedId, creating, revision, active?.version]);

  function refresh() {
    setRevision((n) => n + 1);
  }

  function startNew() {
    retryCommand.current = null;
    setCode('');
    setName('');
    setRefId('');
    setOutcome(null);
    setCreating(true);
  }

  function openUnit(id: string) {
    retryCommand.current = null;
    setOutcome(null);
    setCreating(false);
    setSelectedId(id);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !data) return;
    const input = creating
      ? { operation: 'CREATE', code: code.trim(), name: name.trim(), refId: refId || null }
      : { operation: 'UPDATE', id: active?.id, version: active?.version, code: code.trim(), name: name.trim() };
    const signature = JSON.stringify(input);
    if (retryCommand.current?.signature !== signature) {
      retryCommand.current = { signature, key: `unit-${crypto.randomUUID()}` };
    }
    const idempotencyKey = retryCommand.current.key;
    setSaving(true);
    setOutcome(null);
    try {
      const result = creating
        ? await createOrganizationalUnit({
            ...(refId ? { refId } : {}),
            code: code.trim(), name: name.trim(), idempotencyKey,
          })
        : active
          ? await updateOrganizationalUnit(active.id, {
              code: code.trim(), name: name.trim(),
              expectedVersion: active.version,
              idempotencyKey,
            })
          : null;
      if (!result) return;
      retryCommand.current = null;
      setCreating(false);
      setSelectedId(result.id);
      setOutcome(`Comando confirmado pelo servidor. Unidade ${result.code}, versão ${result.version}.`);
      refresh();
    } catch (error) {
      setOutcome(errorText(error));
      if (!(error instanceof AccessAdminApiError && error.status === 0)) {
        retryCommand.current = null;
        refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  if (loaded.phase === 'loading') {
    return <div role="status" className="p-5 text-sm">Consultando unidades empresariais e permissões…</div>;
  }
  if (loaded.phase === 'error') {
    return (
      <div role="alert" className="space-y-2 rounded-md border border-red-300 p-4 text-sm">
        <p>{loaded.message}</p>
        <button type="button" className="underline" onClick={refresh}>Reconsultar diretório</button>
      </div>
    );
  }

  return (
    <section aria-label="Diretório empresarial de unidades" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Unidades operacionais · Control Tower</h2>
          <p className="text-sm text-gray-600">
            Identidade empresarial independente dos escopos de autorização. Comandos auditados, versionados e idempotentes.
          </p>
        </div>
        {data?.canCreate ? (
          <button type="button" onClick={startNew} className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white">
            Registrar unidade
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-gray-700">
        <span>Unidades configuradas: <strong>{data?.items.length ?? 0}</strong></span>
        <span>Referências sem identidade: <strong>{data?.unconfigured.length ?? 0}</strong></span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(190px,1fr)_minmax(260px,2fr)_minmax(210px,1fr)]">
        <div aria-label="Fila de unidades" className="min-w-0 rounded-md border border-gray-200 p-3">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-600">Work queue · unidades</h3>
          {data?.items.length === 0 ? (
            <p className="text-sm text-gray-600">Nenhuma unidade empresarial configurada neste escopo.</p>
          ) : (
            <div className="max-h-[540px] space-y-1 overflow-auto">
              {data?.items.map((unit) => (
                <button
                  type="button"
                  key={unit.id}
                  onClick={() => openUnit(unit.id)}
                  aria-current={!creating && selectedId === unit.id ? 'true' : undefined}
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${!creating && selectedId === unit.id
                    ? 'border-gray-800 bg-gray-100' : 'border-transparent hover:bg-gray-50'}`}
                >
                  <span className="block font-medium text-gray-900">{unit.name}</span>
                  <span className="block text-xs text-gray-600">{unit.code} · versão {unit.version}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div aria-label="Objeto empresarial ativo" className="min-w-0 rounded-md border border-gray-200 p-3 sm:p-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-600">
            {creating ? 'Nova identidade empresarial' : 'Active business object'}
          </h3>
          {!creating && !active ? (
            <p className="text-sm text-gray-600">Selecione uma unidade na fila ou registre uma nova unidade autorizada.</p>
          ) : (
            <>
              {!creating && active ? (
                <div className="mb-4 space-y-1 border-b border-gray-200 pb-3">
                  <p className="text-lg font-semibold">{active.name}</p>
                  <p className="text-sm text-gray-600">Código {active.code} · versão {active.version}</p>
                </div>
              ) : null}
              <form onSubmit={(event) => { void save(event); }} className="space-y-3">
                {creating && data?.unconfigured.length ? (
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Referência existente (opcional)</span>
                    <select
                      value={refId}
                      onChange={(event) => setRefId(event.target.value)}
                      className="min-h-11 w-full rounded border border-gray-300 bg-white px-2"
                    >
                      <option value="">Criar unidade nova</option>
                      {data.unconfigured.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                ) : null}
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Código empresarial</span>
                  <input
                    required maxLength={64} value={code}
                    onChange={(event) => setCode(event.target.value)}
                    disabled={saving || (!creating && !active?.canManage)}
                    className="min-h-11 w-full rounded border border-gray-300 px-3"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Nome empresarial</span>
                  <input
                    required maxLength={200} value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={saving || (!creating && !active?.canManage)}
                    className="min-h-11 w-full rounded border border-gray-300 px-3"
                  />
                </label>
                {creating && !data?.canCreate ? (
                  <p className="text-sm text-gray-600">Sem permissão de cadastro.</p>
                ) : null}
                {(creating ? data?.canCreate : active?.canManage) ? (
                  <button type="submit" disabled={saving} className="min-h-11 rounded bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {saving ? 'Executando comando…' : creating ? 'Registrar unidade' : 'Salvar nova versão'}
                  </button>
                ) : null}
              </form>
            </>
          )}
          {outcome ? <p role="status" className="mt-4 border-t pt-2 text-sm">{outcome}</p> : null}
        </div>

        <aside aria-label="Contexto da decisão" className="min-w-0 rounded-md border border-gray-200 p-3">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">Decisão · auditoria</h3>
          <p className="mb-3 text-sm text-gray-600">
            Alterações não concedem acesso à operação nem autorizam despacho. Essas permissões são independentes.
          </p>
          {!creating && active ? (
            history.phase === 'loading' ? (
              <p role="status" className="text-sm">Carregando histórico…</p>
            ) : history.phase === 'error' ? (
              <p role="alert" className="text-sm text-red-700">{history.message}</p>
            ) : (
              <ol className="space-y-3">
                {history.value.events.map((event) => (
                  <li key={event.version} className="border-t border-gray-200 pt-2 text-xs">
                    <span className="font-semibold">{event.action === 'CREATED' ? 'Cadastro registrado' : 'Identidade alterada'}</span>
                    <span className="block text-gray-600">Versão {event.version}</span>
                    <time className="block text-gray-600" dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleString('pt-BR')}
                    </time>
                  </li>
                ))}
              </ol>
            )
          ) : (
            <p className="text-sm text-gray-600">Histórico exibido após selecionar um objeto empresarial.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
