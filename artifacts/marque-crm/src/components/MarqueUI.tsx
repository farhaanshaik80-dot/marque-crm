import { CalendarDays, Check, ChevronRight, CircleAlert, Clock3, Mail, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DueItem, VehicleStatus } from '@workspace/api-client-react';

export function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function formatLongDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(value);
}

export function relativeDue(days: number | null, km?: number | null) {
  const parts = [];
  if (days !== null && days !== undefined) {
    if (days < 0) parts.push(`${Math.abs(days)}d overdue`);
    else if (days === 0) parts.push('Due today');
    else if (days === 1) parts.push('Due tomorrow');
    else parts.push(`${days}d to go`);
  }
  if (km !== null && km !== undefined) {
    if (km < 0) parts.push(`${Math.abs(km)}km overdue`);
    else parts.push(`${km}km to go`);
  }
  return parts.length ? parts.join(' · ') : 'Due';
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const copy = label ?? status;
  const tone = status === 'red' ? 'status-red' : status === 'amber' ? 'status-amber' : 'status-green';
  return <span className={`status-pill ${tone}`} data-testid={`status-pill-${status}`}>{copy}</span>;
}

export function DueItemRow({
  clientName,
  item,
  onDraft,
  drafted,
}: {
  clientName?: string;
  item: DueItem;
  onDraft?: () => void;
  drafted?: boolean;
}) {
  const label = item.kind === 'odometer-checkin' && clientName ? `Ask ${clientName} for their current km` : item.label;
  return (
    <div className="flex items-center gap-3 border-t hairline py-3 first:border-t-0" data-testid={`due-item-${item.key || item.kind}`}>
      <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${item.status === 'red' ? 'bg-red-100 text-red-700' : item.status === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
        {item.status === 'green' ? <Check size={15} /> : <Clock3 size={15} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13px] font-semibold text-foreground">{label}</p>
          {item.reminderSent && <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-emerald-700">Sent</span>}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {item.dueDate && <><CalendarDays size={11} /> {formatDate(item.dueDate)} <span className="text-border">·</span></>} 
          {relativeDue(item.daysUntilDue, item.kmUntilDue)}
          {item.dueOdometer !== null && <> <span className="text-border">·</span> Due at {item.dueOdometer}km</>}
        </p>
      </div>
      {item.status !== 'green' && onDraft && (
        <button type="button" onClick={onDraft} disabled={drafted} className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border bg-background px-2.5 py-1.5 text-[11px] font-bold text-foreground transition hover:border-primary hover:bg-accent disabled:cursor-default disabled:opacity-60" data-testid={`button-draft-${item.kind}`}>
          <Mail size={12} /> {drafted ? 'Drafted' : 'Draft'}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border bg-card/70 px-6 py-14 text-center" data-testid="empty-state">
      <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-accent text-primary"><Sparkles size={18} /></div>
      <h3 className="font-serif text-xl text-foreground">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{detail}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function QueryError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" data-testid="status-query-error">
      <span className="flex items-center gap-2"><CircleAlert size={16} /> We couldn’t load this desk view.</span>
      <button type="button" onClick={onRetry} className="font-bold underline underline-offset-4" data-testid="button-retry">Try again</button>
    </div>
  );
}

export function SkeletonRows({ count = 3 }: { count?: number }) {
  return <div className="space-y-3" data-testid="status-loading">{Array.from({ length: count }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-sm bg-muted" />)}</div>;
}

export function VehicleStatusMark({ vehicle }: { vehicle?: VehicleStatus }) {
  if (!vehicle) return <span className="text-[10px] font-mono uppercase tracking-[.1em] text-muted-foreground">No vehicles</span>;
  return <StatusPill status={vehicle.overallStatus} label={vehicle.overallStatus === 'green' ? 'Clear' : vehicle.overallStatus === 'amber' ? 'Review' : 'Action'} />;
}

export function SectionHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-1 font-serif text-2xl text-foreground">{title}</h2>
        {detail && <p className="mt-1.5 text-sm text-muted-foreground">{detail}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function ArrowLink({ children, href }: { children: ReactNode; href: string }) {
  return <a href={href} className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[.14em] text-muted-foreground transition hover:text-foreground" data-testid={`link-${href.replaceAll('/', '') || 'home'}`}>{children}<ChevronRight size={14} /></a>;
}