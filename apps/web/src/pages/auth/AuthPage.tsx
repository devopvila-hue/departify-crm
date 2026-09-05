import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiClientError } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field } from '../../components/design-system/Input';
import { useToast } from '../../components/design-system/Toast';
import { useAuth } from '../../lib/auth';

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
          <div
            className="size-8 rounded-md grid place-items-center text-white text-[14px] font-bold"
            style={{ background: 'linear-gradient(135deg,#9EC84B 0%,#5F8722 100%)' }}
            aria-hidden
          >
            D
          </div>
          <p className="font-semibold text-ink-900">DEPARTIFY CRM</p>
        </div>
        <h1 className="text-xl font-semibold text-ink-900">Inicia sesión</h1>
        <p className="text-sm text-ink-500 mt-1 mb-4">Accede a tu espacio de trabajo.</p>
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
          <div
            className="size-8 rounded-md grid place-items-center text-white text-[14px] font-bold"
            style={{ background: 'linear-gradient(135deg,#9EC84B 0%,#5F8722 100%)' }}
            aria-hidden
          >
            D
          </div>
          <p className="font-semibold text-ink-900">DEPARTIFY CRM</p>
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
