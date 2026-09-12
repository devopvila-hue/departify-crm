/**
 * DEPARTIFY CRM — login + signup.
 *
 * Rules:
 *  - Google/Microsoft buttons MUST be real. They trigger the actual
 *    OAuth round-trip via `/api/v1/auth/oauth/<provider>/start`. If the
 *    deployment has not configured those envs, the API answers 503 and
 *    the toast tells the user what to do. We never render a button that
 *    does not connect.
 *  - Email + password remains a fully supported path.
 *  - Signup navigates to /onboarding on success.
 */
import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api, ApiClientError } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field } from '../../components/design-system/Input';
import { useToast } from '../../components/design-system/Toast';
import { useAuth } from '../../lib/auth';

interface OAuthButtonProps {
  provider: 'google' | 'microsoft';
  label: string;
}

/**
 * Real provider button. window.location.href (NOT the SPA router) because
 * the redirect chain lives on the API origin and the callback lands back
 * at the web origin via `redirect_to` semantics in the backend.
 */
function ProviderButton({ provider, label }: OAuthButtonProps) {
  return (
    <button
      type="button"
      className="btn-outline w-full justify-center text-sm"
      onClick={() => {
        window.location.href = `/api/v1/auth/oauth/${provider}/start`;
      }}
    >
      <span
        className="size-4 inline-flex items-center justify-center rounded-sm border border-current text-[10px] font-semibold"
        aria-hidden
      >
        {provider === 'google' ? 'G' : 'M'}
      </span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useAuth();
  const toast = useToast();

  // If the OAuth callback redirected here with ?oauth=connected|canceled|failed,
  // surface a single toast and strip the query. The /onboarding page handles
  // the "connected" case by re-reading capability-status.
  const search = new URLSearchParams(location.search);
  const oauthResult = search.get('oauth');
  const oauthProvider = search.get('provider');
  if (oauthResult) {
    if (oauthResult === 'connected') {
      toast.push({
        tone: 'ok',
        title: 'Conectado',
        body: `Has conectado ${oauthProvider ?? 'tu cuenta'}.`,
      });
    } else if (oauthResult === 'canceled') {
      toast.push({
        tone: 'info',
        title: 'Cancelado',
        body: 'No pasó nada. Puedes intentarlo de nuevo cuando quieras.',
      });
    } else if (oauthResult === 'failed') {
      toast.push({
        tone: 'bad',
        title: 'No pudimos conectar',
        body: 'Vuelve a intentarlo o usa email y contraseña.',
      });
    }
    // Strip the query so a refresh doesn't repeat the toast.
    navigate('/login', { replace: true });
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/v1/auth/login', { email, password });
      await refresh();
      navigate('/');
    } catch (err) {
      toast.push({
        tone: 'bad',
        title: 'No se pudo iniciar sesión',
        body: (err as ApiClientError).message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh grid place-items-center bg-ink-50 px-4">
      <div className="w-full max-w-sm card-pop p-6 animate-fade-in">
        <div className="flex items-center gap-2 mb-5">
          <img
            src="/brand/departify-d-symbol.png"
            alt="DEPARTIFY"
            width={32}
            height={32}
            className="size-8 rounded-md"
          />
          <p className="font-semibold text-ink-900">DEPARTIFY</p>
        </div>
        <h1 className="text-xl font-semibold text-ink-900">Inicia sesión</h1>
        <p className="text-sm text-ink-500 mt-1 mb-4">Accede a tu espacio de trabajo.</p>
        <div className="space-y-2 mb-4">
          <ProviderButton provider="google" label="Continuar con Google" />
          <ProviderButton provider="microsoft" label="Continuar con Microsoft 365" />
        </div>
        <div className="flex items-center gap-3 my-3" aria-hidden>
          <span className="h-px flex-1 bg-ink-200" />
          <span className="text-[11px] uppercase tracking-wide text-ink-400">o con email</span>
          <span className="h-px flex-1 bg-ink-200" />
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Email">
            <Input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Contraseña">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button variant="accent" className="w-full" type="submit" loading={loading}>
            Entrar
          </Button>
        </form>
        <p className="text-[12px] text-ink-500 mt-4">
          ¿Aún no tienes cuenta?{' '}
          <Link to="/signup" className="text-ink-800 hover:underline">
            Crear organización
          </Link>
        </p>
      </div>
    </div>
  );
}

export function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/v1/auth/signup', { email, password, displayName, organizationName });
      await refresh();
      navigate('/onboarding', { replace: true });
    } catch (err) {
      toast.push({
        tone: 'bad',
        title: 'No se pudo crear la cuenta',
        body: (err as ApiClientError).message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh grid place-items-center bg-ink-50 px-4">
      <div className="w-full max-w-sm card-pop p-6 animate-fade-in">
        <div className="flex items-center gap-2 mb-5">
          <img
            src="/brand/departify-d-symbol.png"
            alt="DEPARTIFY"
            width={32}
            height={32}
            className="size-8 rounded-md"
          />
          <p className="font-semibold text-ink-900">DEPARTIFY</p>
        </div>
        <h1 className="text-xl font-semibold text-ink-900">Crea tu espacio</h1>
        <p className="text-sm text-ink-500 mt-1 mb-4">
          Empieza con una organización. Puedes invitar a tu equipo más tarde.
        </p>
        <div className="space-y-2 mb-4">
          <ProviderButton provider="google" label="Continuar con Google" />
          <ProviderButton provider="microsoft" label="Continuar con Microsoft 365" />
        </div>
        <div className="flex items-center gap-3 my-3" aria-hidden>
          <span className="h-px flex-1 bg-ink-200" />
          <span className="text-[11px] uppercase tracking-wide text-ink-400">o con email</span>
          <span className="h-px flex-1 bg-ink-200" />
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Tu nombre">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Nombre de la organización">
            <Input
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              required
            />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Contraseña" hint="Mínimo 8 caracteres">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </Field>
          <Button variant="accent" className="w-full" type="submit" loading={loading}>
            Crear espacio
          </Button>
        </form>
        <p className="text-[12px] text-ink-500 mt-4">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-ink-800 hover:underline">
            Inicia sesión
          </Link>
        </p>
        <p className="text-[11px] text-ink-400 mt-4">
          Al crear el espacio, Departify empieza a preparar tu organización. Conectar otras
          herramientas es opcional y puedes hacerlo después.
        </p>
      </div>
    </div>
  );
}
