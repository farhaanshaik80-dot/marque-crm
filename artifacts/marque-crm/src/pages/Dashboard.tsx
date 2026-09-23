import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CarFront, CircleCheck, Search, UsersRound } from 'lucide-react';
import {
  getGetDashboardQueryKey,
  getListClientsQueryKey,
  useDraftReminder,
  useGetDashboard,
  useListClients,
  useMarkReminderSent,
  type ClientSummary,
  type DueItem,
} from '@workspace/api-client-react';
import { DueItemRow, EmptyState, QueryError, SectionHeading, SkeletonRows, VehicleStatusMark, formatDate, formatLongDate, relativeDue } from '@/components/MarqueUI';

function StatCard({ label, value, note, icon: Icon, accent }: { label: string; value: number; note: string; icon: typeof UsersRound; accent?: boolean }) {
  return <div className={`relative overflow-hidden rounded-sm border border-border bg-card p-5 ${accent ? 'bg-primary text-primary-foreground' : ''}`} data-testid={`stat-card-${label.toLowerCase().replaceAll(' ', '-')}`}>
    <div className="flex items-start justify-between"><p className={`text-[10px] font-bold uppercase tracking-[.18em] ${accent ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>{label}</p><Icon size={16} className={accent ? 'text-secondary' : 'text-primary'} /></div>
    <p className={`mt-5 font-mono text-3xl tracking-tight ${accent ? 'text-primary-foreground' : 'text-foreground'}`} data-testid={`text-stat-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</p>
    <p className={`mt-2 text-xs ${accent ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>{note}</p>
  </div>;
}

export default function Dashboard() {
  const dashboardQuery = useGetDashboard();
  const clientsQuery = useListClients();
  const queryClient = useQueryClient();
  const draftReminder = useDraftReminder();
  const markSent = useMarkReminderSent();
  const [search, setSearch] = useState('');
  const [draftedKey, setDraftedKey] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState('');
  const dashboard = dashboardQuery.data;
  const clients = useMemo<ClientSummary[]>(() => clientsQuery.data ?? dashboard?.clients ?? [], [clientsQuery.data, dashboard?.clients]);
  const dueItems = useMemo(() => clients.flatMap((client) => client.vehicles.flatMap((vehicle) => vehicle.dueItems.filter((item) => item.status !== 'green').map((item) => ({ client, vehicle, item })))).sort((a, b) => {
    const aVal = a.item.daysUntilDue ?? a.item.kmUntilDue ?? 0;
    const bVal = b.item.daysUntilDue ?? b.item.kmUntilDue ?? 0;
    return aVal - bVal;
  }), [clients]);
  const selectedReminder = useMemo(() => dueItems.find(({ client, vehicle, item }) => `${client.id}-${vehicle.id}-${item.key || item.kind}` === draftedKey), [dueItems, draftedKey]);
  const whatsappHref = selectedReminder && draftMessage ? `https://wa.me/${selectedReminder.client.phone.replace(/\D/g, '')}?text=${encodeURIComponent(draftMessage)}` : '#';
  const filteredClients = clients.filter((client) => client.name.toLowerCase().includes(search.toLowerCase()) || client.vehicles.some((vehicle) => vehicle.model.toLowerCase().includes(search.toLowerCase())));

  const draft = (client: ClientSummary, vehicle: ClientSummary['vehicles'][number], item: DueItem) => {
    const key = `${client.id}-${vehicle.id}-${item.key || item.kind}`;
    setDraftedKey(key);
    draftReminder.mutate({ 
      data: { 
        clientName: client.name, 
        model: vehicle.model, 
        plate: vehicle.plate, 
        dueLabel: item.kind === 'odometer-checkin' ? `Ask ${client.name} for their current km` : item.label, 
        dueDate: item.dueDate, 
        daysUntilDue: item.daysUntilDue,
        reminderType: item.kind === 'odometer-checkin' ? 'odometer-checkin' : 'due-item',
        currentOdometer: vehicle.currentOdometer
      } 
    }, { onSuccess: (result) => setDraftMessage(result.message) });
  };
  const sendDraft = (client: ClientSummary, vehicle: ClientSummary['vehicles'][number], item: DueItem) => {
    markSent.mutate({ data: { clientId: client.id, vehicleId: vehicle.id, dueKey: item.key || item.kind, messageText: draftMessage } }, { onSuccess: () => { setDraftMessage(''); setDraftedKey(null); queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }); } });
  };

  if (dashboardQuery.isLoading && !dashboard) return <div className="mx-auto max-w-[1400px] p-5 sm:p-8 lg:p-11"><SkeletonRows count={5} /></div>;
  if (dashboardQuery.isError) return <div className="mx-auto max-w-[1400px] p-5 sm:p-8 lg:p-11"><QueryError onRetry={() => dashboardQuery.refetch()} /></div>;

  return <div className="marque-grid min-h-[calc(100dvh-72px)]">
    <div className="mx-auto max-w-[1400px] p-5 sm:p-8 lg:p-11">
       <div className="marque-slide-up flex flex-col justify-between gap-5 border-b border-border pb-8 sm:flex-row sm:items-end">
         <div><p className="eyebrow">{formatLongDate().replace(',', ' ·')}</p><h1 className="mt-2 max-w-xl font-serif text-4xl leading-[1.05] tracking-tight text-foreground sm:text-5xl">Good morning, Alex.</h1><p className="mt-3 text-sm text-muted-foreground">A composed view of the people and machines in your care.</p></div>
        <Link href="/clients/new" className="inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-primary px-4 text-xs font-bold uppercase tracking-[.13em] text-primary-foreground transition hover:-translate-y-0.5 hover:bg-primary/90" data-testid="link-add-client"><span className="text-secondary">＋</span> Add client</Link>
      </div>
      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="marque-slide-up marque-delay-1"><StatCard label="Clients" value={dashboard?.totalClients ?? clients.length} note="Across the trial group" icon={UsersRound} /></div>
        <div className="marque-slide-up marque-delay-1"><StatCard label="Vehicles" value={dashboard?.totalVehicles ?? clients.reduce((sum, client) => sum + client.vehicles.length, 0)} note="Currently under care" icon={CarFront} /></div>
        <div className="marque-slide-up marque-delay-2"><StatCard label="Due soon" value={dashboard?.dueSoonCount ?? dueItems.length} note="Needs a considered touch" icon={ArrowUpRight} accent /></div>
        <div className="marque-slide-up marque-delay-2"><StatCard label="Sent this month" value={dashboard?.sentThisMonth ?? 0} note="Reminders thoughtfully sent" icon={CircleCheck} /></div>
      </div>
      <div className="mt-10 grid gap-8 xl:grid-cols-[1.1fr_.9fr]">
        <section className="marque-slide-up marque-delay-3 rounded-sm border border-border bg-card p-5 sm:p-7">
          <SectionHeading eyebrow="Needs attention" title="The attention queue" detail="A short list of details worth handling today." action={<span className="font-mono text-xs text-muted-foreground">{dueItems.length.toString().padStart(2, '0')} open</span>} />
          {dueItems.length === 0 ? <EmptyState title="Nothing pressing" detail="Every registration, policy and service date is in good standing." /> : <div className="divide-y divide-border/70">{dueItems.slice(0, 6).map(({ client, vehicle, item }) => <div key={`${client.id}-${vehicle.id}-${item.key || item.kind}`} className="flex flex-wrap items-center gap-3 py-3.5 first:pt-0 last:pb-0" data-testid={`row-attention-${vehicle.id}-${item.key || item.kind}`}><div className="min-w-0 flex-1"><Link href={`/clients/${client.id}`} className="text-sm font-bold text-foreground hover:underline" data-testid={`link-attention-client-${client.id}`}>{client.name}</Link><p className="mt-1 text-xs text-muted-foreground">{vehicle.model} <span className="mx-1 text-border">·</span> {item.kind === 'odometer-checkin' ? `Ask ${client.name} for their current km` : item.label}</p></div><div className="text-right"><p className={`font-mono text-xs ${item.status === 'red' ? 'text-red-700' : 'text-amber-700'}`}>{relativeDue(item.daysUntilDue, item.kmUntilDue)}</p>{item.dueDate && <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(item.dueDate)}</p>}</div><button type="button" className="rounded-sm border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[.12em] text-foreground transition hover:border-primary hover:bg-accent" onClick={() => draft(client, vehicle, item)} data-testid={`button-draft-attention-${vehicle.id}-${item.key || item.kind}`}>{draftedKey === `${client.id}-${vehicle.id}-${item.key || item.kind}` ? (draftReminder.isPending ? 'Writing…' : 'Draft ready') : 'Draft note'}</button></div>)}</div>}
        </section>
        <section className="marque-slide-up marque-delay-4 rounded-sm border border-border bg-card p-5 sm:p-7">
          <SectionHeading eyebrow="Client register" title="Your people" detail="Quick access to every relationship." action={<div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a client" className="h-8 w-36 rounded-sm border border-border bg-background pl-8 pr-2 text-xs outline-none transition focus:border-primary sm:w-44" data-testid="input-search-clients" /></div>} />
          <div className="space-y-1.5">{filteredClients.slice(0, 7).map((client) => <Link key={client.id} href={`/clients/${client.id}`} className="group flex items-center gap-3 rounded-sm border border-transparent px-2 py-3 transition hover:border-border hover:bg-background" data-testid={`row-client-${client.id}`}><div className="flex size-9 items-center justify-center rounded-full bg-accent font-serif text-sm text-primary">{client.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-bold text-foreground">{client.name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{client.vehicles.length} vehicle{client.vehicles.length === 1 ? '' : 's'} <span className="mx-1 text-border">·</span> {client.tier}</p></div><div className="flex items-center gap-2"><VehicleStatusMark vehicle={client.vehicles[0]} /><ArrowUpRight size={14} className="text-muted-foreground transition group-hover:text-primary" /></div></Link>)}</div>
          {filteredClients.length === 0 && <EmptyState title="No match" detail="Try a name or vehicle model." />}
        </section>
      </div>
      {draftMessage && <div className="fixed bottom-5 right-5 z-20 w-[min(420px,calc(100vw-40px))] rounded-sm border border-border bg-card p-5 shadow-xl" data-testid="panel-reminder-draft"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Suggested note</p><h3 className="mt-1 font-serif text-xl">Ready for your edit</h3></div><button type="button" className="text-xs text-muted-foreground" onClick={() => { setDraftMessage(''); setDraftedKey(null); }} data-testid="button-close-draft">Close</button></div><textarea value={draftMessage} onChange={(event) => setDraftMessage(event.target.value)} className="mt-4 min-h-28 w-full resize-y rounded-sm border border-input bg-background p-3 text-sm leading-6 outline-none focus:border-primary" data-testid="textarea-dashboard-reminder-message" /><div className="mt-4 grid grid-cols-2 gap-2"><a href={whatsappHref} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-sm border border-border px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-[.12em] text-foreground transition hover:border-primary hover:bg-accent" data-testid="link-whatsapp-draft">Send on WhatsApp</a><button type="button" onClick={() => { if (selectedReminder) sendDraft(selectedReminder.client, selectedReminder.vehicle, selectedReminder.item); }} className="rounded-sm bg-primary px-3 py-2.5 text-[10px] font-bold uppercase tracking-[.12em] text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50" disabled={markSent.isPending || !selectedReminder} data-testid="button-send-draft">{markSent.isPending ? 'Saving…' : 'Mark as sent'}</button></div></div>}
    </div>
  </div>;
}