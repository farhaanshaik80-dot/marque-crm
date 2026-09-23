import { Bell, CarFront, ChevronDown, LayoutDashboard, LogOut, Menu, Plus, UsersRound, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useState, type ReactNode } from 'react';
import { formatLongDate } from '@/components/MarqueUI';

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/clients/new', label: 'Add client', icon: Plus },
];

export function MarqueShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = (href: string) => href === '/' ? location === '/' : location.startsWith(href);
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-[88px] items-center justify-between border-b border-sidebar-border px-7">
          <Link href="/" className="group flex items-center gap-3" data-testid="link-brand">
            <span className="flex size-9 items-center justify-center border border-sidebar-primary/60 text-sidebar-primary"><CarFront size={18} strokeWidth={1.5} /></span>
            <span><span className="block font-serif text-[22px] leading-none tracking-tight">marque</span><span className="mt-1 block font-mono text-[8px] uppercase tracking-[.28em] text-sidebar-foreground/55">concierge desk</span></span>
          </Link>
          <button type="button" className="text-sidebar-foreground/65 md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-menu"><X size={19} /></button>
        </div>
        <div className="px-4 pt-8">
          <p className="px-3 text-[10px] font-bold uppercase tracking-[.2em] text-sidebar-foreground/40">Workspace</p>
          <nav className="mt-3 space-y-1">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 rounded-sm px-3 py-2.5 text-[13px] font-semibold transition ${active(href) ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`} data-testid={`link-nav-${label.toLowerCase().replace(' ', '-')}`}>
                <Icon size={16} strokeWidth={1.7} className={active(href) ? 'text-sidebar-primary' : ''} /> {label}
              </Link>
            ))}
          </nav>
          <div className="mt-8 border-t border-sidebar-border pt-6">
            <p className="px-3 text-[10px] font-bold uppercase tracking-[.2em] text-sidebar-foreground/40">Shortcuts</p>
            <div className="mt-3 space-y-1">
              <Link href="/" className="flex items-center gap-3 rounded-sm px-3 py-2.5 text-[13px] text-sidebar-foreground/60 transition hover:bg-sidebar-accent hover:text-sidebar-foreground" data-testid="link-nav-clients"><UsersRound size={16} strokeWidth={1.7} /> All clients</Link>
              <button type="button" className="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left text-[13px] text-sidebar-foreground/60 transition hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={() => window.dispatchEvent(new Event('marque-notifications'))} data-testid="button-notifications"><Bell size={16} strokeWidth={1.7} /> Notifications <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" /></button>
            </div>
          </div>
        </div>
        <div className="mt-auto border-t border-sidebar-border px-7 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-full bg-sidebar-primary text-[11px] font-bold text-sidebar-primary-foreground">AM</div>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">Alex Morgan</p><p className="mt-0.5 text-[10px] text-sidebar-foreground/45">Operations lead</p></div>
            <ChevronDown size={14} className="text-sidebar-foreground/40" />
          </div>
        </div>
      </aside>
      {mobileOpen && <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 bg-foreground/20 md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-menu-backdrop" />}
      <main className="md:pl-[248px]">
        <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md sm:px-8 lg:px-11">
          <button type="button" className="mr-3 text-muted-foreground md:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-menu"><Menu size={21} /></button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-600" /> Trial group <span className="hidden sm:inline">/ London desk</span></div>
          <div className="flex items-center gap-3"><span className="hidden text-[11px] text-muted-foreground sm:block">{formatLongDate()}</span><button type="button" className="rounded-sm p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" data-testid="button-header-notifications"><Bell size={17} /></button><button type="button" className="rounded-sm p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" data-testid="button-logout"><LogOut size={16} /></button></div>
        </header>
        {children}
      </main>
    </div>
  );
}