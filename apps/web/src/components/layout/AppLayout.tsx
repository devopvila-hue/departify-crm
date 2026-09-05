import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useToast } from '../design-system/Toast';
import { initials } from '../../lib/format';
import clsx from 'clsx';

const items = [
  { to: '/', label: 'Inicio', icon: 'home' },
  { to: '/contacts', label: 'Contactos', icon: 'people' },
  { to: '/companies', label: 'Empresas', icon: 'building' },
  { to: '/pipeline', label: 'Pipeline', icon: 'kanban' },
  { to: '/tasks', label: 'Tareas', icon: 'check' },
  { to: '/settings/keys', label: 'Integraciones', icon: 'plug' },
] as const;

function Icon({ name }: { name: 'home' | 'people' | 'building' | 'kanban' | 'check' | 'plug' }) {
  switch (name) {
    case 'home':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v10h14V10" />
        </svg>
      );
    case 'people':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="9" cy="9" r="3.5" />
          <path d="M2.5 20a6.5 6.5 0 0113 0" />
          <circle cx="17" cy="8" r="2.5" />
          <path d="M21.5 17a4.5 4.5 0 00-7-3.7" />
        </svg>
      );
    case 'building':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="4" y="3" width="16" height="18" />
          <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3" />
        </svg>
      );
    case 'kanban':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="4" width="5" height="16" />
          <rect x="10" y="4" width="5" height="10" />
          <rect x="17" y="4" width="4" height="13" />
        </svg>
      );
    case 'check':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'plug':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M9 3v4M15 3v4" />
          <rect x="7" y="7" width="10" height="6" />
          <path d="M12 13v3a4 4 0 01-4 4" />
        </svg>
      );
  }
}

export function AppLayout() {
  const { me, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh grid grid-cols-[240px_1fr] bg-ink-50">
      <aside className="bg-white border-r border-ink-200 flex flex-col">
        <div className="px-5 py-5 flex items-center gap-2.5">
          <img
            src="/brand/departify-d-symbol.png"
            alt="DEPARTIFY"
            width={32}
            height={32}
            className="size-8 rounded-md"
          />
          <div className="leading-tight">
            <p className="text-[15px] font-semibold text-ink-900">DEPARTIFY</p>
            <p className="text-[11px] text-ink-500">CRM operativo</p>
          </div>
        </div>

        <nav className="px-3 py-2 flex-1 space-y-0.5">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm',
                  isActive ? 'bg-ink-100 text-ink-900 font-medium' : 'text-ink-700 hover:bg-ink-50',
                )
              }
            >
              <Icon name={it.icon} />
              {it.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-ink-200">
          {me && (
            <div className="flex items-center gap-2.5 px-2 py-2">
              <span
                className="inline-grid place-items-center size-8 rounded-full bg-ink-100 text-ink-800 text-[12px] font-semibold"
                aria-hidden
              >
                {initials(me.displayName)}
              </span>
              <div className="leading-tight min-w-0">
                <p className="text-[13px] font-medium text-ink-900 truncate">{me.displayName}</p>
                <p className="text-[11px] text-ink-500 truncate">{me.orgName}</p>
              </div>
            </div>
          )}
          <button
            className="mt-2 w-full text-left text-[12px] text-ink-500 hover:text-ink-800 px-2"
            onClick={async () => {
              await logout();
              toast.push({ tone: 'info', title: 'Sesión cerrada' });
              navigate('/login');
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
