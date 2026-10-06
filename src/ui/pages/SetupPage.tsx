import { useRef, useState } from 'react';
import { TIEBREAK_LABELS, type TiebreakId } from '../../engine/types';
import { exportJson, useTournament } from '../../store/useTournament';

const ALL_TIEBREAKS = Object.keys(TIEBREAK_LABELS) as TiebreakId[];

export default function SetupPage() {
  const t = useTournament((s) => s.tournament);
  const { updateInfo, setSystem, importJson, reset } = useTournament.getState();
  const started = t.rounds.length > 0;

  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const moveTb = (i: number, d: -1 | 1) => {
    const list = [...t.tiebreaks];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    updateInfo({ tiebreaks: list });
  };

  const download = () => {
    const blob = new Blob([exportJson(t)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${t.name.replace(/[^\w-]+/g, '_') || 'tournament'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImport = async (file: File) => {
    const err = importJson(await file.text());
    setMsg(err ? { kind: 'error', text: err } : { kind: 'ok', text: `Imported “${file.name}”.` });
  };

  const swissRoundWarning = t.system === 'swiss' && t.players.length > 0 && t.totalRounds >= t.players.length - 2;

  return (
    <div className="stack">
      <section className="card">
        <h2>Tournament</h2>
        <div className="grid-form">
          <label>
            Name
            <input value={t.name} onChange={(e) => updateInfo({ name: e.target.value })} />
          </label>
          <label>
            Location
            <input value={t.location} onChange={(e) => updateInfo({ location: e.target.value })} />
          </label>
          <label>
            Chief arbiter
            <input value={t.arbiter} onChange={(e) => updateInfo({ arbiter: e.target.value })} />
          </label>
          <label>
            Start date
            <input type="date" value={t.startDate} onChange={(e) => updateInfo({ startDate: e.target.value })} />
          </label>
          <label>
            System
            <select value={t.system} disabled={started} onChange={(e) => setSystem(e.target.value as typeof t.system)}>
              <option value="swiss">Swiss (simplified Dutch)</option>
              <option value="roundrobin">Round robin (Berger)</option>
            </select>
          </label>
          <label>
            Rounds
            <input
              type="number"
              min={Math.max(1, t.rounds.length)}
              max={30}
              value={t.totalRounds}
              disabled={t.system === 'roundrobin'}
              onChange={(e) => updateInfo({ totalRounds: Math.max(t.rounds.length, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </label>
          {t.system === 'swiss' && (
            <label>
              Pairing bye scores
              <select value={t.byePoints} onChange={(e) => updateInfo({ byePoints: Number(e.target.value) as 1 | 0.5 })}>
                <option value={1}>1 point</option>
                <option value={0.5}>½ point</option>
              </select>
            </label>
          )}
        </div>
        {t.system === 'roundrobin' && <p className="hint">Round robin: rounds are set from the number of players.</p>}
        {swissRoundWarning && (
          <p className="banner warn">
            {t.totalRounds} rounds with {t.players.length} players is close to a round robin — the last rounds may be impossible
            to pair without rematches. Consider fewer rounds or the round-robin system.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Tiebreak order</h2>
        <ol className="tb-list">
          {t.tiebreaks.map((id, i) => (
            <li key={id}>
              <span>{TIEBREAK_LABELS[id]}</span>
              <span className="row-actions">
                <button className="ghost" onClick={() => moveTb(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button className="ghost" onClick={() => moveTb(i, 1)} disabled={i === t.tiebreaks.length - 1} aria-label="Move down">↓</button>
                <button className="ghost" onClick={() => updateInfo({ tiebreaks: t.tiebreaks.filter((x) => x !== id) })} aria-label="Remove">✕</button>
              </span>
            </li>
          ))}
        </ol>
        <div className="row">
          {ALL_TIEBREAKS.filter((id) => !t.tiebreaks.includes(id)).map((id) => (
            <button key={id} className="secondary small" onClick={() => updateInfo({ tiebreaks: [...t.tiebreaks, id] })}>
              + {TIEBREAK_LABELS[id]}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Data</h2>
        <p className="hint">Everything is saved in this browser automatically. Export a backup file now and then.</p>
        <div className="row">
          <button onClick={download}>Export JSON</button>
          <button className="secondary" onClick={() => fileRef.current?.click()}>Import JSON</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </div>
        {msg && <p className={`banner ${msg.kind === 'error' ? 'error' : 'ok'}`}>{msg.text}</p>}

        <div className="danger-zone">
          <h3>Reset</h3>
          <p className="hint">Deletes the tournament, all players and rounds from this browser. Type RESET to confirm.</p>
          <div className="row">
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESET" aria-label="Type RESET to confirm" />
            <button
              className="danger"
              disabled={confirm !== 'RESET'}
              onClick={() => {
                reset();
                setConfirm('');
                setMsg({ kind: 'ok', text: 'Tournament reset.' });
              }}
            >
              Reset everything
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
