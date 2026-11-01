import { useState, type FormEvent } from 'react';
import {
  AccessAdminApiError, approveSodException, listSodExceptions,
  requestSodException, revokeSodException,
} from '../api/access-admin-api';
import { mapAccessAdminErrorToMessage } from '../api/access-admin-error-messages';
import { useAsyncResource } from '../hooks/useAccessAdminData';
import type { SodException } from '../types';
import {
  Alert, Button, EmptyState, ErrorState, Field, Input, LoadingState, Select, Textarea,
  worklistTableCardClass, worklistTableClass, worklistHeadCellClass,
  worklistCellClass, worklistRowClass,
} from '../../ui';

/** Presentation only: identity, SoD and approval remain exclusively server-authoritative. */
export function SodExceptionsTab() {
  const { state, refresh } = useAsyncResource<SodException[]>(listSodExceptions);
  const [subject, setSubject] = useState('');
  const [scopeType, setScopeType] = useState('GLOBAL');
  const [anchor, setAnchor] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      refresh();
    } catch (cause) {
      setError(cause instanceof AccessAdminApiError
        ? mapAccessAdminErrorToMessage(cause.code, cause.status)
        : 'Não foi possível executar a operação SoD.');
    } finally {
      setBusy(false);
    }
  }

  async function request(event: FormEvent) {
    event.preventDefault();
    await mutate(async () => {
      await requestSodException({
        subjectIdentityId: subject.trim(), scopeType,
        scopeAnchor: scopeType === 'GLOBAL' ? undefined : anchor.trim(),
        reason: reason.trim(),
      });
      setReason('');
    });
  }

  return (
    <div className="space-y-6">
      <Alert tone="info">
        Exceção SOD-007 permanente até revogação. A solicitação não libera acesso.
        Somente a conta autenticada rafael@cisne.invalid com permissão de administração
        pode aprovar ou revogar. Não há autoaprovação. Revogar desativa as atribuições
        criadas sob esta exceção; a segregação de atos financeiros continua obrigatória.
      </Alert>
      <form onSubmit={(event) => void request(event)}
        className="grid gap-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h2 className="text-sm font-semibold text-gray-900">Solicitar exceção SOD-007</h2>
          <p className="mt-1 text-sm text-gray-500">
            Informe a identidade real e o escopo exato. A aprovação nunca é automática.
          </p>
        </div>
        <Field label="Identidade beneficiária (UUID)" htmlFor="sod-subject" required>
          <Input id="sod-subject" value={subject} onChange={(event) => setSubject(event.target.value)}
            required disabled={busy} />
        </Field>
        <Field label="Escopo" htmlFor="sod-scope" required>
          <Select id="sod-scope" value={scopeType} disabled={busy}
            onChange={(event) => setScopeType(event.target.value)}>
            <option value="GLOBAL">GLOBAL</option>
            <option value="UNIT">UNIT</option>
            <option value="CLIENT">CLIENT</option>
            <option value="CONTRACT">CONTRACT</option>
            <option value="FINANCIAL">FINANCIAL</option>
            <option value="DOCUMENT">DOCUMENT</option>
          </Select>
        </Field>
        {scopeType !== 'GLOBAL' && (
          <Field label="Âncora autorizada" htmlFor="sod-anchor" required>
            <Input id="sod-anchor" value={anchor} required disabled={busy}
              onChange={(event) => setAnchor(event.target.value)} />
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label="Justificativa auditável (10–500 caracteres)" htmlFor="sod-reason" required>
            <Textarea id="sod-reason" value={reason} minLength={10} maxLength={500}
              required disabled={busy} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy || reason.trim().length < 10 || !subject.trim()}>
            Solicitar aprovação
          </Button>
        </div>
      </form>
      {error && <Alert tone="error">{error}</Alert>}
      {state.phase === 'loading' && <LoadingState label="Carregando exceções SoD…" />}
      {state.phase === 'error' && (
        <ErrorState title="Exceções SoD" message="Não foi possível carregar as exceções."
          onRetry={refresh} />
      )}
      {state.phase === 'ready' && state.data.length === 0 && (
        <EmptyState title="Nenhuma exceção registrada"
          description="Nenhuma exceção foi solicitada ou aprovada." />
      )}
      {state.phase === 'ready' && state.data.length > 0 && (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Exceções SoD auditáveis">
            <thead>
              <tr>
                {['Beneficiário', 'Regra / escopo', 'Justificativa', 'Solicitante',
                  'Aprovador', 'Estado', 'Ações'].map((label) => (
                  <th key={label} scope="col" className={worklistHeadCellClass}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.data.map((entry) => (
                <tr key={entry.id} className={worklistRowClass}>
                  <td className={worklistCellClass}>{entry.subjectIdentityId}</td>
                  <td className={worklistCellClass}>
                    {entry.ruleId} · {entry.scopeType} {entry.scopeAnchor ?? ''}
                  </td>
                  <td className={worklistCellClass}>{entry.reason}</td>
                  <td className={worklistCellClass}>{entry.requestedByIdentityId}</td>
                  <td className={worklistCellClass}>
                    {entry.approvedByIdentityId ?? '—'}
                  </td>
                  <td className={worklistCellClass}>{entry.status}</td>
                  <td className={worklistCellClass}>
                    {entry.status === 'PENDING' && (
                      <Button type="button" variant="secondary" disabled={busy}
                        onClick={() => void mutate(() => approveSodException(entry.id))}>
                        Aprovar
                      </Button>
                    )}
                    {entry.status === 'APPROVED' && confirmRevoke !== entry.id && (
                      <Button type="button" variant="secondary" disabled={busy}
                        onClick={() => setConfirmRevoke(entry.id)}>Revogar…</Button>
                    )}
                    {entry.status === 'APPROVED' && confirmRevoke === entry.id && (
                      <div className="flex gap-2">
                        <Button type="button" disabled={busy}
                          onClick={() => {
                            setConfirmRevoke(null);
                            void mutate(() => revokeSodException(entry.id));
                          }}>Confirmar revogação</Button>
                        <Button type="button" variant="secondary" disabled={busy}
                          onClick={() => setConfirmRevoke(null)}>Cancelar</Button>
                      </div>
                    )}
                    {entry.status === 'REVOKED' && <span>Revogada</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
