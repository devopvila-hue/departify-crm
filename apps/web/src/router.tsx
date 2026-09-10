import { Navigate, createBrowserRouter, RouterProvider } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppLayout } from './components/layout/AppLayout';
import { HomePage } from './pages/home/HomePage';
import { ContactsPage } from './pages/contacts/ContactsPage';
import { ContactDetailPage } from './pages/contacts/ContactDetailPage';
import { CompaniesPage } from './pages/companies/CompaniesPage';
import { CompanyDetailPage } from './pages/companies/CompanyDetailPage';
import { PipelinePage } from './pages/pipelines/PipelinePage';
import { DealDetailPage } from './pages/pipelines/DealDetailPage';
import { ActivityPage } from './pages/activity/ActivityPage';
import { TasksPage } from './pages/tasks/TasksPage';
import { IntegrationsPage } from './pages/settings/IntegrationsPage';
import { LoginPage, SignupPage } from './pages/auth/AuthPage';
import { EmailIndexPage } from './pages/email/EmailIndexPage';
import { SendersPage } from './pages/email/SendersPage';
import { TemplatesPage } from './pages/email/TemplatesPage';
import { SequencesPage } from './pages/email/SequencesPage';
import { EnrollmentsPage } from './pages/email/EnrollmentsPage';
import { SuppressionsPage } from './pages/email/SuppressionsPage';
import { AIAssistantPage } from './pages/email/AIAssistantPage';
import type { ReactNode } from 'react';

function Protected({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <div className="p-8 text-sm text-ink-500">Cargando…</div>;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AnonOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return null;
  if (me) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: '/login', element: <AnonOnly><LoginPage /></AnonOnly> },
  { path: '/signup', element: <AnonOnly><SignupPage /></AnonOnly> },
  {
    path: '/',
    element: (
      <Protected>
        <AppLayout />
      </Protected>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'activity', element: <ActivityPage /> },
      { path: 'contacts', element: <ContactsPage /> },
      { path: 'contacts/:id', element: <ContactDetailPage /> },
      { path: 'companies', element: <CompaniesPage /> },
      { path: 'companies/:id', element: <CompanyDetailPage /> },
      { path: 'pipeline', element: <PipelinePage /> },
      { path: 'deals/:id', element: <DealDetailPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'settings/keys', element: <IntegrationsPage /> },
      // Email / Sequences (Sprint 5)
      { path: 'email', element: <EmailIndexPage /> },
      { path: 'email/senders', element: <SendersPage /> },
      { path: 'email/templates', element: <TemplatesPage /> },
      { path: 'email/sequences', element: <SequencesPage /> },
      { path: 'email/sequences/:id', element: <EnrollmentsPage /> },
      { path: 'email/suppressions', element: <SuppressionsPage /> },
      { path: 'email/ai', element: <AIAssistantPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
