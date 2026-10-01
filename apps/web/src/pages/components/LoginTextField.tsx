import { Eye, EyeOff } from 'lucide-react';
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../ui/utils/cn';

type LoginTextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Ícone de condução exibido à esquerda dentro do campo. */
  icon: ReactNode;
  /** Habilita o botão de mostrar/ocultar (apenas para senha). */
  revealable?: boolean;
  invalid?: boolean;
};

/**
 * Campo de texto do login: ícone de condução, altura fixa e — para senha — o
 * botão de revelar. O rótulo acessível continua vindo do `<label>` externo; o
 * botão de revelar é o único elemento com `aria-label` próprio.
 */
export function LoginTextField({
  id,
  icon,
  revealable = false,
  invalid,
  disabled,
  className,
  ...props
}: LoginTextFieldProps) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const [visible, setVisible] = useState(false);
  const type = revealable && visible ? 'text' : revealable ? 'password' : 'text';

  return (
    <div className={cn('login-field', invalid && 'login-field--invalid', className)}>
      <span className="login-field__icon" aria-hidden="true">
        {icon}
      </span>

      <input
        id={fieldId}
        type={type}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className="login-field__input"
        {...props}
      />

      {revealable ? (
        <button
          type="button"
          className="login-field__toggle"
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
          aria-pressed={visible}
          aria-controls={fieldId}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        >
          {visible ? (
            <EyeOff className="login-field__toggle-icon" aria-hidden="true" />
          ) : (
            <Eye className="login-field__toggle-icon" aria-hidden="true" />
          )}
        </button>
      ) : null}
    </div>
  );
}
