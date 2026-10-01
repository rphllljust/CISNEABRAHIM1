import type { AvailableAction } from '../types/service-order-meta.types';

export type CommandActionButtonProps = {
  action: AvailableAction;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  className?: string;
};

/**
 * Botão de comando dirigido pelo BACKEND.
 *
 * O rótulo vem de `action.label` (produzido pelo `/command-catalog` no backend) — nunca
 * de um mapa hardcoded no front. `usuario_tem_permissao` vem resolvido pelo próprio
 * backend, então o botão fica VISÍVEL mas desabilitado quando o usuário não pode executar,
 * com o motivo exposto em `title` (tooltip).
 *
 * Visível-e-desabilitado, em vez de oculto: o operador precisa saber que a ação existe e
 * que lhe falta permissão — esconder transformaria uma restrição de acesso em um mistério.
 */
export function CommandActionButton({
  action,
  onClick,
  disabled = false,
  variant = 'secondary',
  className,
}: CommandActionButtonProps) {
  const lackingPermission = !action.usuario_tem_permissao;
  const isDisabled = disabled || lackingPermission;

  const base =
    variant === 'primary'
      ? 'inline-flex items-center rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60'
      : 'text-left disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <button
      type="button"
      className={className ?? base}
      disabled={isDisabled}
      title={
        lackingPermission
          ? `Você não tem a permissão ${action.requer_permissao}.`
          : undefined
      }
      aria-disabled={isDisabled}
      data-command={action.comando}
      onClick={onClick}
    >
      {action.label}
    </button>
  );
}
