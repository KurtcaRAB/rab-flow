import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Stage, Staff } from '../lib/types';
import { StatusChip, TopBar, money } from '../ui';
import ListEditor from './ListEditor';
import StaffEditor from './StaffEditor';

const TABS = ['Customers', 'Yard locations', 'Materials', 'Labour rates', 'Extras', 'Staff'] as const;
type Tab = (typeof TABS)[number];

export default function Settings({ me, onBack }: { me: Staff; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('Customers');
  const [stages, setStages] = useState<Stage[]>([]);
  useEffect(() => { api.stages().then(setStages); }, []);
  const stageName = (id: number) => stages.find((s) => s.id === id)?.name ?? '';

  return (
    <>
      <TopBar title="Settings" onBack={onBack} />
      <nav className="sticky top-16 z-10 flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`${tab === t ? 'btn-primary' : 'btn-ghost'} min-h-10 shrink-0 px-4 text-sm`}>{t}</button>
        ))}
      </nav>
      <main className="mx-auto max-w-3xl p-4">
        {tab === 'Customers' && (
          <ListEditor table="customers" noun="customer"
            blank={() => ({ name: '', contact_name: null, phone: null, email: null, notes: null, active: true })}
            title={(r) => r.name}
            subtitle={(r) => [r.contact_name, r.phone].filter(Boolean).join(' · ')}
            fields={[
              { key: 'name', label: 'Customer name', kind: 'text', required: true },
              { key: 'contact_name', label: 'Contact name', kind: 'text' },
              { key: 'phone', label: 'Phone', kind: 'text' },
              { key: 'email', label: 'Email', kind: 'text' },
              { key: 'notes', label: 'Notes', kind: 'textarea' },
            ]} />
        )}
        {tab === 'Yard locations' && (
          <ListEditor table="yard_locations" noun="location"
            blank={() => ({ name: '', sort_order: 99, active: true })}
            title={(r) => r.name}
            sort={(a, b) => a.sort_order - b.sort_order}
            fields={[
              { key: 'name', label: 'Location name', kind: 'text', required: true },
              { key: 'sort_order', label: 'Order in lists (1 = first)', kind: 'number' },
            ]} />
        )}
        {tab === 'Materials' && (
          <ListEditor table="materials" noun="material"
            blank={() => ({ name: '', type: 'primer', manufacturer: null, sds_url: null, pds_url: null, sds_status: null, notes: null, active: true, cost_per_l: 0, charge_per_l: 0 })}
            title={(r) => r.name}
            subtitle={(r) => (
              <span className="flex flex-wrap items-center gap-2">
                {r.type === 'primer' ? 'Primer' : 'Topcoat'} · {money(r.cost_per_l)}/L cost · {money(r.charge_per_l)}/L charge
                <StatusChip status={r.sds_status} />
              </span>
            )}
            fields={[
              { key: 'name', label: 'Product name', kind: 'text', required: true },
              { key: 'type', label: 'Type', kind: 'select', options: [{ value: 'primer', label: 'Primer' }, { value: 'topcoat', label: 'Topcoat' }] },
              { key: 'manufacturer', label: 'Manufacturer', kind: 'text' },
              { key: 'cost_per_l', label: 'Cost per litre', kind: 'money' },
              { key: 'charge_per_l', label: 'Charge-out per litre', kind: 'money' },
              { key: 'sds_url', label: 'Safety data sheet (SDS) link', kind: 'url' },
              { key: 'pds_url', label: 'Product data sheet link', kind: 'url' },
              { key: 'sds_status', label: 'SDS status', kind: 'select', options: [
                { value: '', label: '—' }, { value: 'Found', label: 'Found' }, { value: 'Check variant', label: 'Check variant' }, { value: 'Not found', label: 'Not found' },
              ] },
              { key: 'notes', label: 'Notes', kind: 'textarea' },
            ]} />
        )}
        {tab === 'Labour rates' && stages.length > 0 && (
          <>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Hourly rates. The default rate for a stage is used when someone logs hours on it.</p>
            <ListEditor table="labour_rates" noun="labour rate"
              blank={() => ({ name: '', stage_id: stages[0].id, cost_per_hour: 0, charge_per_hour: 0, is_default: false, active: true })}
              title={(r) => r.name}
              sort={(a, b) => a.stage_id - b.stage_id || a.name.localeCompare(b.name)}
              subtitle={(r) => `${stageName(r.stage_id)}${r.is_default ? ' (default)' : ''} · ${money(r.cost_per_hour)}/h cost · ${money(r.charge_per_hour)}/h charge`}
              fields={[
                { key: 'name', label: 'Rate name', kind: 'text', required: true },
                { key: 'stage_id', label: 'Stage', kind: 'select', options: stages.map((s) => ({ value: s.id, label: s.name })) },
                { key: 'cost_per_hour', label: 'Cost per hour', kind: 'money' },
                { key: 'charge_per_hour', label: 'Charge-out per hour', kind: 'money' },
                { key: 'is_default', label: 'Default rate for this stage', kind: 'bool' },
              ]} />
          </>
        )}
        {tab === 'Extras' && (
          <>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Flat charges added to a job with a quantity. 2 x Transport is charged twice.</p>
            <ListEditor table="extras" noun="extra"
              blank={() => ({ name: '', unit_cost: 0, unit_charge: 0, active: true })}
              title={(r) => r.name}
              subtitle={(r) => `${money(r.unit_cost)} cost · ${money(r.unit_charge)} charge, each`}
              fields={[
                { key: 'name', label: 'Name', kind: 'text', required: true },
                { key: 'unit_cost', label: 'Cost each', kind: 'money' },
                { key: 'unit_charge', label: 'Charge-out each', kind: 'money' },
              ]} />
          </>
        )}
        {tab === 'Staff' && <StaffEditor me={me} />}
      </main>
    </>
  );
}
