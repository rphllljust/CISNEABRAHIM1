import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { userMessageText } from '../auth/api/auth-api';
import { mapLoginError, useAuth } from '../auth/context/AuthProvider';
import { sanitizeRedirectPath } from '../auth/utils/safe-redirect';
import { Lock, User } from 'lucide-react';
import { Alert } from '../ui/Alert';
import { CisneWordmark } from './components/CisneWordmark';
import { LoginHero } from './components/LoginHero';
import { LoginTextField } from './components/LoginTextField';
import './login.css';

const PAGE_TITLE = 'CISNE Rondônia — Acessar conta';
const LOGIN_SUPPORT_EMAIL = 'suporte@cisne.ro.gov.br';

type LocationState = {
  from?: string;
  reason?: 'session_expired';
};

export function LoginPage() {
  const loginId = useId();
  const passwordId = useId();
  const formErrorId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const { login, status } = useAuth();
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submitGenerationRef = useRef(0);

  const locationState = (location.state as LocationState | null) ?? {};
  const redirectTo = sanitizeRedirectPath(locationState.from);
  const sessionExpiredNotice =
    locationState.reason === 'session_expired'
      ? 'Sua sessão expirou. Entre novamente para continuar.'
      : null;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = PAGE_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) {
      return;
    }

    const generation = submitGenerationRef.current + 1;
    submitGenerationRef.current = generation;
    setErrorMessage(null);
    setLoading(true);

    try {
      await login(loginValue.trim(), password);
      if (generation !== submitGenerationRef.current) {
        return;
      }
      void navigate(redirectTo, { replace: true });
    } catch (error) {
      if (generation !== submitGenerationRef.current) {
        return;
      }
      const message = mapLoginError(error);
      if (message === 'account_disabled') {
        void navigate('/access-denied', { replace: true });
        return;
      }
      setPassword('');
      setErrorMessage(userMessageText(message));
    } finally {
      if (generation === submitGenerationRef.current) {
        setLoading(false);
      }
    }
  }

  if (status === 'authenticated') {
    return <Navigate to={redirectTo} replace />;
  }

  if (status === 'unavailable') {
    return <Navigate to="/unavailable" replace />;
  }

  const showFieldInvalid = Boolean(errorMessage);

  return (
    <main className="login-page">
      <div className="stage">
        <LoginHero />

        <div className="form-side login-panel">
          <div className="card fade-up d2">
            <CisneWordmark />
            <div className="card-eyebrow">Acesso institucional</div>
            <h2 id="login-form-title">Acessar conta</h2>
            <p className="lead">Entre com suas credenciais para continuar.</p>

            {sessionExpiredNotice ? (
              <Alert tone="info" className="login-page__notice" role="status">
                {sessionExpiredNotice}
              </Alert>
            ) : null}

            <form
              onSubmit={(event) => void handleSubmit(event)}
              noValidate
              aria-labelledby="login-form-title"
              aria-describedby={errorMessage ? formErrorId : undefined}
            >
              <div className="field">
                <label htmlFor={loginId}>
                  Usuário <span className="req">*</span>
                </label>
                <LoginTextField
                  id={loginId}
                  name="login"
                  autoComplete="username"
                  inputMode="text"
                  placeholder="usuario.institucional"
                  required
                  value={loginValue}
                  onChange={(event) => setLoginValue(event.target.value)}
                  disabled={loading}
                  invalid={showFieldInvalid}
                  aria-describedby={errorMessage ? formErrorId : undefined}
                  icon={<User className="login-field__lead-icon" aria-hidden="true" />}
                />
              </div>

              <div className="field field--password">
                <label htmlFor={passwordId}>
                  Senha <span className="req">*</span>
                </label>
                <LoginTextField
                  id={passwordId}
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  invalid={showFieldInvalid}
                  disabled={loading}
                  revealable
                  aria-describedby={errorMessage ? formErrorId : undefined}
                  icon={<Lock className="login-field__lead-icon" aria-hidden="true" />}
                />
              </div>

              {errorMessage ? (
                <Alert tone="error" role="alert" id={formErrorId}>
                  {errorMessage}
                </Alert>
              ) : null}

              <button
                type="submit"
                className="submit"
                disabled={loading}
                aria-busy={loading}
                aria-label={loading ? 'Carregando: Entrando' : undefined}
              >
                {loading ? (
                  'Entrando…'
                ) : (
                  <>
                    Entrar <span className="arrow">→</span>
                  </>
                )}
              </button>
            </form>

            <p className="fine">Acesso restrito a usuários autorizados</p>

            <div className="card-foot">
              <span>v2.4.1</span>
              <a href={`mailto:${LOGIN_SUPPORT_EMAIL}`}>{LOGIN_SUPPORT_EMAIL}</a>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
