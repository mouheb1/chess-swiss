import { useEffect, useState } from 'react';
import { useStorageStatus, useTournament } from '../store/useTournament';
import { CloseIcon, CrosstableIcon, MenuIcon, PlayersIcon, RoundsIcon, SetupIcon, StandingsIcon } from './icons';
import CrosstablePage from './pages/CrosstablePage';
import PlayersPage from './pages/PlayersPage';
import RoundsPage from './pages/RoundsPage';
import SetupPage from './pages/SetupPage';
import StandingsPage from './pages/StandingsPage';

const TABS = [
  { id: 'setup', label: 'Setup', Page: SetupPage, Icon: SetupIcon },
  { id: 'players', label: 'Players', Page: PlayersPage, Icon: PlayersIcon },
  { id: 'rounds', label: 'Rounds', Page: RoundsPage, Icon: RoundsIcon },
  { id: 'standings', label: 'Standings', Page: StandingsPage, Icon: StandingsIcon },
  { id: 'crosstable', label: 'Crosstable', Page: CrosstablePage, Icon: CrosstableIcon },
] as const;

type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId {
  const h = window.location.hash.slice(1);
  return (TABS.find((t) => t.id === h)?.id ?? 'setup') as TabId;
}

export default function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [menuOpen, setMenuOpen] = useState(false);
  const t = useTournament((s) => s.tournament);
  const storageFailed = useStorageStatus((s) => s.failed);

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

  const current = TABS.find((x) => x.id === tab)!;
  const { Page } = current;
  const subtitle = `${t.system === 'swiss' ? 'Swiss' : 'Round robin'} · round ${t.rounds.length}/${t.totalRounds} · ${t.players.length} players`;

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
        <nav className="tabs">
          {TABS.map((x) => (
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
          aria-label="Open menu"
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
          <button className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Close menu" tabIndex={menuOpen ? 0 : -1}>
            <CloseIcon />
          </button>
        </div>
        <nav className="drawer-nav">
          {TABS.map(({ id, label, Icon }) => (
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
        </div>
      </aside>

      {storageFailed && (
        <div className="banner error no-print">
          Your browser refused to save. Changes will be lost on refresh — export a backup from Setup.
        </div>
      )}
      <main className="page">
        <Page />
      </main>
    </div>
  );
}
