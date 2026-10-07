import { useEffect, useState } from 'react';
import { useSync } from '../store/sync';
import { useCanEdit, useCurrentTournament, useStorageStatus } from '../store/useTournament';
import { ArbiterControl, ChoiceDialog, SyncNotice } from './Arbiter';
import { CloseIcon, CrosstableIcon, MenuIcon, PlayersIcon, RoundsIcon, SetupIcon, StandingsIcon } from './icons';
import CrosstablePage from './pages/CrosstablePage';
import PlayersPage from './pages/PlayersPage';
import RoundsPage from './pages/RoundsPage';
import SetupPage from './pages/SetupPage';
import StandingsPage from './pages/StandingsPage';

const TABS = [
  { id: 'setup', label: 'Paramètres', Page: SetupPage, Icon: SetupIcon },
  { id: 'players', label: 'Joueurs', Page: PlayersPage, Icon: PlayersIcon },
  { id: 'rounds', label: 'Rondes', Page: RoundsPage, Icon: RoundsIcon },
  { id: 'standings', label: 'Classement', Page: StandingsPage, Icon: StandingsIcon },
  { id: 'crosstable', label: 'Grille', Page: CrosstablePage, Icon: CrosstableIcon },
] as const;

type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId | null {
  const h = window.location.hash.slice(1);
  return (TABS.find((t) => t.id === h)?.id ?? null) as TabId | null;
}

export default function App() {
  const [hashTab, setTab] = useState<TabId | null>(tabFromHash);
  const [menuOpen, setMenuOpen] = useState(false);
  const t = useCurrentTournament();
  const canEdit = useCanEdit();
  const ready = useSync((s) => s.ready);
  const storageFailed = useStorageStatus((s) => s.failed);

  // Viewers don't get the settings page; they land on the pairings.
  const tabs = canEdit ? TABS : TABS.filter((x) => x.id !== 'setup');
  // While sign-ups are open and nothing is paired yet, viewers land on the sign-up form.
  const viewerHome = t.registrationOpen && t.rounds.length === 0 ? 'players' : 'rounds';
  const tab: TabId = hashTab && tabs.some((x) => x.id === hashTab) ? hashTab : canEdit ? 'setup' : viewerHome;

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // A tap on a menu item has already navigated; close the drawer over the page it opened.
  useEffect(() => {
    setMenuOpen(false);
  }, [tab]);

  // The page behind an open drawer should not scroll under the thumb.
  useEffect(() => {
    if (!menuOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const current = tabs.find((x) => x.id === tab)!;
  const { Page } = current;
  const subtitle = `${t.system === 'swiss' ? 'Suisse' : 'Toutes rondes'} · ronde ${t.rounds.length}/${t.totalRounds} · ${t.players.length} joueurs`;

  return (
    <div className="app">
      {/* Desktop chrome */}
      <header className="app-header no-print">
        <div className="brand">
          <span className="brand-mark" aria-hidden>♞</span>
          <div>
            <div className="brand-name">Swiss Lite</div>
            <div className="brand-sub">
              {t.name} · {subtitle}
            </div>
          </div>
        </div>
        <ArbiterControl />
        <nav className="tabs">
          {tabs.map((x) => (
            <a key={x.id} href={`#${x.id}`} className={x.id === tab ? 'tab active' : 'tab'}>
              {x.label}
            </a>
          ))}
        </nav>
      </header>

      {/* Mobile chrome: navigation lives in an off-canvas drawer below 768px. */}
      <header className="mobile-bar no-print">
        <button
          className="icon-btn"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Ouvrir le menu"
          aria-expanded={menuOpen}
        >
          <MenuIcon />
        </button>
        <div className="mobile-title">
          <span className="mobile-page">{current.label}</span>
          <span className="mobile-sub">{t.name}</span>
        </div>
        <span className="round-badge">
          R{t.rounds.length}/{t.totalRounds}
        </span>
      </header>

      {menuOpen && <div className="drawer-overlay no-print" onClick={() => setMenuOpen(false)} aria-hidden />}
      <aside className={menuOpen ? 'drawer open no-print' : 'drawer no-print'} aria-hidden={!menuOpen}>
        <div className="drawer-head">
          <span className="brand">
            <span className="brand-mark" aria-hidden>♞</span>
            <span className="brand-name">Swiss Lite</span>
          </span>
          <button className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Fermer le menu" tabIndex={menuOpen ? 0 : -1}>
            <CloseIcon />
          </button>
        </div>
        <nav className="drawer-nav">
          {tabs.map(({ id, label, Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={id === tab ? 'drawer-link active' : 'drawer-link'}
              tabIndex={menuOpen ? 0 : -1}
              onClick={() => setMenuOpen(false)}
            >
              <Icon />
              {label}
            </a>
          ))}
        </nav>
        <div className="drawer-foot">
          <div className="drawer-name">{t.name}</div>
          <div className="hint">{subtitle}</div>
          <ArbiterControl />
        </div>
      </aside>

      {storageFailed && (
        <div className="banner error no-print">
          Votre navigateur refuse d'enregistrer. Les modifications seront perdues au rechargement — exportez une sauvegarde depuis Paramètres.
        </div>
      )}
      <SyncNotice />
      <ChoiceDialog />
      <main className="page">{ready ? <Page /> : <p className="empty">Chargement…</p>}</main>
    </div>
  );
}
