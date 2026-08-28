import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  Activity, AudioLines, Coins, Image, LayoutDashboard, LogOut, Menu, Moon, Settings,
  Shield, Sparkles, Sun, User, Users, Workflow, X, Boxes, ScrollText, SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Avatar, Badge, Button } from '../ui';
import { formatNumber } from '../../lib/format';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

const WORKSPACE_NAV: NavItem[] = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true },
  { to: '/generation', label: 'Generation', icon: Sparkles },
  { to: '/galerie', label: 'Galerie', icon: Image },
  { to: '/modeles', label: 'Modeles', icon: Boxes },
  { to: '/audio', label: 'Audio', icon: AudioLines },
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/historique', label: 'Historique', icon: Activity },
  { to: '/profil', label: 'Profil', icon: User },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Supervision', icon: Shield, end: true },
  { to: '/admin/collaborateurs', label: 'Collaborateurs', icon: Users },
  { to: '/admin/credits', label: 'Credits', icon: Coins },
  { to: '/admin/modeles', label: 'Modeles IA', icon: SlidersHorizontal },
  { to: '/admin/journal', label: "Journal d'activite", icon: ScrollText },
  { to: '/admin/parametres', label: 'Parametres', icon: Settings },
];

function NavSection({ title, items, onNavigate }: { title: string; items: NavItem[]; onNavigate: () => void }) {
  return (
    <div className="px-3">
      <p className="px-3 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-fg">
        {title}
      </p>
      <nav className="space-y-0.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13.5px] font-medium transition-colors',
                isActive
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]',
              )
            }
          >
            <item.icon className="size-[17px] shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function AppShell() {
  const { user, logout, isAdmin } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // La navigation mobile se referme a chaque changement de page.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  if (!user) return null;

  const lowCredits = user.credits.balance < 50 && !user.credits.allowOverdraft;

  return (
    <div className="flex h-full">
      {menuOpen ? (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden />
      ) : null}

      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-raised)] transition-transform lg:static lg:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-[9px] bg-[var(--accent)] text-white">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <div className="leading-tight">
              <p className="text-[14px] font-semibold">Nova Studio</p>
              <p className="truncate text-[11px] text-muted-fg">{user.organizationName}</p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Fermer le menu"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="scroll-fade min-h-0 flex-1 overflow-y-auto pb-4">
          <NavSection title="Mon espace" items={WORKSPACE_NAV} onNavigate={() => setMenuOpen(false)} />
          {/* Les entrees d'administration ne sont affichees qu'aux administrateurs ;
              l'API applique de son cote le meme controle sur chaque route. */}
          {isAdmin ? (
            <NavSection title="Administration" items={ADMIN_NAV} onNavigate={() => setMenuOpen(false)} />
          ) : null}
        </div>

        <div className="border-t border-[var(--border-subtle)] p-3">
          <div className="mb-2 rounded-[10px] bg-[var(--surface-base)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-secondary-fg">Credits disponibles</span>
              <Coins className="size-3.5 text-[var(--text-muted)]" aria-hidden />
            </div>
            <p className={clsx('mt-1 text-lg font-semibold tabular-nums', lowCredits && 'text-[var(--warning)]')}>
              {formatNumber(user.credits.balance)}
            </p>
            {user.credits.allowOverdraft ? (
              <Badge tone="info" className="mt-1.5">Decouvert autorise</Badge>
            ) : lowCredits ? (
              <Badge tone="warning" className="mt-1.5">Solde faible</Badge>
            ) : null}
          </div>

          <div className="flex items-center gap-2 rounded-[10px] p-1.5 hover:bg-[var(--surface-hover)]">
            <Avatar name={user.name} color={user.avatarColor} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{user.name}</p>
              <p className="truncate text-[11px] text-muted-fg">
                {user.role === 'admin' ? 'Administrateur' : 'Collaborateur'}
              </p>
            </div>
            <button
              type="button"
              onClick={toggle}
              aria-label="Changer de theme"
              className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <button
              type="button"
              aria-label="Se deconnecter"
              onClick={async () => {
                await logout();
                navigate('/connexion');
              }}
              className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)]"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-base)]/85 px-4 backdrop-blur lg:px-6">
          <button
            type="button"
            className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu className="size-4" />
          </button>
          <div className="min-w-0 flex-1" />
          {lowCredits ? (
            <Badge tone="warning">Solde faible : {formatNumber(user.credits.balance)} credits</Badge>
          ) : null}
          <Button size="sm" icon={<Sparkles className="size-4" />} onClick={() => navigate('/generation')}>
            <span className="hidden sm:inline">Nouvelle generation</span>
            <span className="sm:hidden">Generer</span>
          </Button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-6">
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
