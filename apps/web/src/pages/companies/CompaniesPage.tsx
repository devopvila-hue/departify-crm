import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field } from '../../components/design-system/Input';
import { Modal } from '../../components/design-system/Modal';
import { EmptyState } from '../../components/design-system/EmptyState';
import { Badge } from '../../components/design-system/Badge';
import { useToast } from '../../components/design-system/Toast';
import { formatShortDate } from '../../lib/format';

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  status: 'active' | 'inactive' | 'archived';
  createdAt: string;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function CompaniesPage() {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['companies', search],
    queryFn: () => api.get<Page<Company>>(`/api/v1/companies?pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  });
  return (
    <div className="px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Empresas</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">Cuentas</h1>
        </div>
        <Button variant="accent" onClick={() => setCreateOpen(true)}>Nueva empresa</Button>
      </header>
      <div className="card p-3 mb-4">
        <Input placeholder="Buscar por nombre, dominio, ciudad o sector" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {isLoading && <p className="text-sm text-ink-500">Cargando…</p>}
      {data && data.items.length === 0 && (
        <EmptyState
          title="Sin empresas"
          description="Crea la primera para empezar a clasificar tus cuentas."
          action={<Button variant="accent" onClick={() => setCreateOpen(true)}>Crear empresa</Button>}
        />
      )}
      {data && data.items.length > 0 && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Sector</th>
                <th>Ubicación</th>
                <th>Estado</th>
                <th className="text-right">Creada</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/companies/${c.id}`} className="block">
                      <p className="text-sm font-medium text-ink-900">{c.name}</p>
                      {c.domain && <p className="text-[11px] text-ink-500">{c.domain}</p>}
                    </Link>
                  </td>
                  <td className="text-ink-700">{c.industry ?? '—'}</td>
                  <td className="text-ink-700">{[c.city, c.country].filter(Boolean).join(', ') || '—'}</td>
                  <td>
                    <Badge tone={c.status === 'active' ? 'ok' : 'neutral'}>{c.status}</Badge>
                  </td>
                  <td className="text-right text-[12px] text-ink-500">{formatShortDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateCompanyModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateCompanyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [industry, setIndustry] = useState('');
  const [country, setCountry] = useState('ES');
  const [city, setCity] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const create = useMutation({
    mutationFn: () => api.post('/api/v1/companies', { name, domain: domain || undefined, industry: industry || undefined, country, city: city || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['companies'] });
      toast.push({ tone: 'ok', title: 'Empresa creada', body: name });
      onClose();
      setName(''); setDomain(''); setIndustry(''); setCity('');
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva empresa"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="accent" onClick={() => create.mutate()} disabled={!name || create.isPending} loading={create.isPending}>Crear</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Dominio"><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="empresa.com" /></Field>
        <Field label="Sector"><Input value={industry} onChange={(e) => setIndustry(e.target.value)} /></Field>
        <Field label="País"><Input value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
        <Field label="Ciudad"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
