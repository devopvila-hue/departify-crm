import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiClientError } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field } from '../../components/design-system/Input';
import { useToast } from '../../components/design-system/Toast';
import { useAuth } from '../../lib/auth';

/**
 * Customer-facing provider buttons. DEPARTIFY presents ONE choice
 * (Google / Microsoft) and orchestrates whatever the underlying
 * capabilities need. No OAuth credentials exist yet, so the button
 * routes through the normal email/password flow for now; the contract
 * for the future provider flow lives in the onboarding copy ("conectarás"),
 * never fabricating a finished connection.
 */
function ProviderButton({ label, sub, tone }: { label: string; sub: string; tone: 'google' | 'microsoft' }) {
  return (
    <button
      type="button"
      className="btn-outline w-full justify-center text-sm"
      onClick={() => {
        /* provider flow placeholder — document handled in onboarding */
      }}
    >
      <span className="size-4" aria-hidden>{tone === 'google' ? 'G' : '⊞'}</span>
      <span className="font-medium">{label}</span>
      <span className="sr-only">{sub}</span>
    </button>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 my-4" aria-hidden>
      <span className="h-px flex-1 bg-ink-200" />
      <span className="text-[11px] uppercase tracking-wide text-ink-400">o con email</span>
      <span className="h-px flex-1 bg-ink-200" />
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/v1/auth/login', { email, password });
      await refresh();
      navigate('/');
    } catch (err) {
      toast.push({ tone: 'bad', title: 'No se pudo iniciar sesión', body: (err as ApiClientError).message });
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
        <div className="space-y-2">
          <ProviderButton label="Continuar con Google" sub="Usa tu cuenta de Google" tone="google" />
          <ProviderButton label="Continuar con Microsoft" sub="Usa tu cuenta de Microsoft" tone="microsoft" />
        </div>
        <Divider />
        <form onSubmit={submit} className="space-y-3">
          <Field label="Email">
            <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Contraseña">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button variant="accent" className="w-full" type="submit" loading={loading}>Entrar</Button>
        </form>
        <p className="text-[12px] text-ink-500 mt-4">
          ¿Aún no tienes cuenta? <Link to="/signup" className="text-ink-800 hover:underline">Crear organización</Link>
        </p>
        <p className="text-[11px] text-ink-400 mt-4">
          Al continuar, Departify empieza a preparar tu empresa. Conectar tus herramientas es opcional y puedes hacerlo después.
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
      navigate('/');
    } catch (err) {
      toast.push({ tone: 'bad', title: 'No se pudo crear la cuenta', body: (err as ApiClientError).message });
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
        <p className="text-sm text-ink-500 mt-1 mb-4">Empieza con una organización. Puedes invitar a tu equipo más tarde.</p>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Tu nombre"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required autoFocus /></Field>
          <Field label="Nombre de la organización"><Input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} required /></Field>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Contraseña" hint="Mínimo 8 caracteres"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></Field>
          <Button variant="accent" className="w-full" type="submit" loading={loading}>Crear espacio</Button>
        </form>
        <p className="text-[12px] text-ink-500 mt-4">
          ¿Ya tienes cuenta? <Link to="/login" className="text-ink-800 hover:underline">Inicia sesión</Link>
        </p>
      </div>
    </div>
  );
}
