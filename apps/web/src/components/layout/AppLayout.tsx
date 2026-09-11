import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../../lib/auth';
import { useToast } from '../design-system/Toast';
import { initials } from '../../lib/format';

const primaryItems = [
  { to: '/', label: 'Resumen', icon: 'home', end: true },
  { to: '/pipeline', label: 'Pipeline', icon: 'kanban', end: false },
  { to: '/companies', label: 'Empresas', icon: 'building', end: false },
  { to: '/contacts', label: 'Personas', icon: 'people', end: false },
  { to: '/activity', label: 'Actividad', icon: 'activity', end: false },
] as const;

const toolItems = [
  { to: '/tasks', label: 'Tareas', icon: 'check', end: false },
  { to: '/email', label: 'Email', icon: 'mail', end: false },
  { to: '/settings/keys', label: 'Integraciones', icon: 'plug', end: false },
] as const;

type IconName = (typeof primaryItems)[number]['icon'] | (typeof toolItems)[number]['icon'];

function Icon({ name }: { name: IconName }) {
  switch (name) {
    case 'home':
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v10h14V10" />
        </svg>
      );
    case 'people':
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <circle cx="9" cy="9" r="3.5" />
          <path d="M2.5 20a6.5 6.5 0 0113 0" />
          <circle cx="17" cy="8" r="2.5" />
          <path d="M21.5 17a4.5 4.5 0 00-7-3.7" />
        </svg>
      );
    case 'building':
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <rect x="4" y="3" width="16" height="18" />
          <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3" />
        </svg>
      );
    case 'kanban':
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <rect x="3" y="4" width="5" height="16" />
          <rect x="10" y="4" width="5" height="10" />
          <rect x="17" y="4" width="4" height="13" />
        </svg>
      );
    case 'activity':
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
        </svg>
      );
    case 'check':
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'plug':
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M9 3v4M15 3v4" />
          <rect x="7" y="7" width="10" height="6" />
          <path d="M12 13v3a4 4 0 01-4 4" />
        </svg>
      );
    case 'mail':
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 6 9-6" />
        </svg>
      );
  }
}

const STORAGE_KEY = 'departify-sidebar-collapsed';

function readCollapsedPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsedPref(v: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function AppLayout() {
  const { me, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  // Drawer state for < lg. ≥ lg the sidebar is persistent; on those screens
  // this only controls the backdrop overlay which we hide via lg:hidden.
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop collapsed state (icon-only sidebar). Persisted to localStorage.
  const [desktopCollapsed, setDesktopCollapsed] = useState<boolean>(() => readCollapsedPref());

  useEffect(() => {
    writeCollapsedPref(desktopCollapsed);
  }, [desktopCollapsed]);

  // Close mobile drawer on Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // Auto-close mobile drawer on resize to ≥ lg.
  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 1024 && mobileOpen) setMobileOpen(false);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mobileOpen]);

  const asideWidth = desktopCollapsed ? 'lg:w-[68px]' : 'lg:w-[240px]';
  const showLabels = !desktopCollapsed;

  return (
    <div className="min-h-dvh bg-ink-50 lg:flex">
      {/* Mobile topbar */}
      <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-ink-200 px-4 py-2.5 flex items-center gap-2">
        <button
          type="button"
          aria-label="Abrir menú"
          onClick={() => setMobileOpen(true)}
          className="size-9 grid place-items-center rounded-md hover:bg-ink-100"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <img
          src="/brand/departify-d-symbol.png"
          alt=""
          width={28}
          height={28}
          className="size-7 rounded-md"
        />
        <span className="text-[14px] font-semibold text-ink-900">DEPARTIFY</span>
      </header>

      {/* Backdrop for mobile drawer */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-ink-900/40"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          'bg-white border-r border-ink-200 flex flex-col z-50',
          'transition-transform duration-150',
          mobileOpen
            ? 'fixed top-0 left-0 bottom-0 w-[260px] translate-x-0'
            : 'fixed top-0 left-0 bottom-0 w-[260px] -translate-x-full',
          'lg:static lg:translate-x-0 lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-dvh lg:self-start',
          asideWidth,
        )}
        aria-label="Navegación principal"
      >
        <div
          className={clsx(
            'px-5 py-5 flex items-center gap-2.5',
            desktopCollapsed && 'lg:justify-center lg:px-0',
          )}
        >
          <img
            src="/brand/departify-d-symbol.png"
            alt="DEPARTIFY"
            width={32}
            height={32}
            className="size-8 rounded-md shrink-0"
          />
          {showLabels && (
            <div className="leading-tight">
              <p className="text-[15px] font-semibold text-ink-900">DEPARTIFY</p>
              <p className="text-[11px] text-ink-500">CRM operativo</p>
            </div>
          )}
        </div>

        <nav
          className="px-3 py-2 flex-1 space-y-0.5 overflow-y-auto"
          aria-label="Navegación principal"
        >
          {primaryItems.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              onClick={() => setMobileOpen(false)}
              title={desktopCollapsed ? it.label : undefined}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 rounded-md text-sm',
                  showLabels ? 'px-2.5 py-2' : 'lg:justify-center lg:size-9 lg:px-0',
                  isActive ? 'bg-ink-100 text-ink-900 font-medium' : 'text-ink-700 hover:bg-ink-50',
                )
              }
            >
              <Icon name={it.icon} />
              {showLabels && <span className="truncate">{it.label}</span>}
            </NavLink>
          ))}

          <div
            className={clsx('pt-2 mt-2 border-t border-ink-100', !showLabels && 'lg:pt-2')}
            role="separator"
          />
          {toolItems.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              onClick={() => setMobileOpen(false)}
              title={desktopCollapsed ? it.label : undefined}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 rounded-md text-sm',
                  showLabels ? 'px-2.5 py-2' : 'lg:justify-center lg:size-9 lg:px-0',
                  isActive ? 'bg-ink-100 text-ink-900 font-medium' : 'text-ink-700 hover:bg-ink-50',
                )
              }
            >
              <Icon name={it.icon} />
              {showLabels && <span className="truncate">{it.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-ink-200 space-y-1">
          {me && (
            <div
              className={clsx(
                'flex items-center gap-2.5 px-2 py-2',
                desktopCollapsed && 'lg:justify-center lg:px-0',
              )}
            >
              <span
                className="inline-grid place-items-center size-8 rounded-full bg-ink-100 text-ink-800 text-[12px] font-semibold shrink-0"
                aria-hidden
              >
                {initials(me.displayName)}
              </span>
              {showLabels && (
                <div className="leading-tight min-w-0">
                  <p className="text-[13px] font-medium text-ink-900 truncate">{me.displayName}</p>
                  <p className="text-[11px] text-ink-500 truncate">{me.orgName}</p>
                </div>
              )}
            </div>
          )}
          <div
            className={clsx('flex', desktopCollapsed ? 'lg:flex-col lg:gap-1' : 'flex-col gap-1')}
          >
            <button
              type="button"
              aria-label={desktopCollapsed ? 'Expandir menú' : 'Colapsar menú'}
              onClick={() => setDesktopCollapsed((v) => !v)}
              className={clsx(
                'text-[12px] text-ink-500 hover:text-ink-800 px-2 py-1.5 rounded-md hover:bg-ink-50 hidden lg:block',
                !showLabels ? 'lg:text-center' : 'lg:text-left',
              )}
            >
              {desktopCollapsed ? '»' : '« Colapsar'}
            </button>
            <button
              type="button"
              className="text-[12px] text-ink-500 hover:text-ink-800 px-2 py-1.5 rounded-md hover:bg-ink-50 text-left"
              onClick={async () => {
                await logout();
                toast.push({ tone: 'info', title: 'Sesión cerrada' });
                navigate('/login');
              }}
            >
              {showLabels ? 'Cerrar sesión' : '⎋'}
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
