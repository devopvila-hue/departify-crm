import { NavLink } from 'react-router-dom';

const items = [
  { to: '/email/senders', label: 'Remitentes', desc: 'Direcciones de envío y credenciales cifradas.' },
  { to: '/email/templates', label: 'Plantillas', desc: 'Plantillas con variables {{first_name}}.' },
  { to: '/email/sequences', label: 'Secuencias', desc: 'Builder con EMAIL / WAIT / CONDITIONAL / EXIT.' },
  { to: '/email/suppressions', label: 'Supresiones', desc: 'Lista de no-enviar (bounces, unsubscribes, manual).' },
  { to: '/email/ai', label: 'Asistente IA', desc: 'Enriquecer, lead score, redactor de respuestas, radar de riesgos.' },
] as const;

export function EmailIndexPage() {
  return (
    <div className="px-8 py-6 max-w-[900px] mx-auto animate-fade-in">
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Email</p>
        <h1 className="text-2xl font-semibold text-ink-900 mt-1">Automatización de email</h1>
        <p className="text-sm text-ink-500 mt-1 max-w-xl">
          Gestiona tus envíos, plantillas y secuencias de correo para que el seguimiento comercial no dependa de la memoria.
        </p>
      </header>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((it) => (
          <li key={it.to}>
            <NavLink
              to={it.to}
              className="block rounded-xl border border-ink-200 bg-paper p-4 hover:border-ink-400 transition-colors"
            >
              <p className="text-sm font-semibold text-ink-900">{it.label}</p>
              <p className="text-[12px] text-ink-500 mt-1">{it.desc}</p>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
