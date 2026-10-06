import { useMemo, useState } from 'react';
import { isRoundComplete, startingRank, summarize } from '../../engine/scores';
import type { Result } from '../../engine/types';
import { useTournament } from '../../store/useTournament';
import { fmtPoints, playerLabel } from '../format';

const MAIN_RESULTS: Exclude<Result, null>[] = ['1-0', '½-½', '0-1'];
const FORFEITS: { value: Exclude<Result, null>; label: string }[] = [
  { value: '+/-', label: '+ / − (white wins by forfeit)' },
  { value: '-/+', label: '− / + (black wins by forfeit)' },
  { value: '0-0', label: '0 / 0 (both forfeit)' },
];

export default function RoundsPage() {
  const t = useTournament((s) => s.tournament);
  const { pairNextRound, setResult, swapColors, deleteLastRound, toggleHalfBye } = useTournament.getState();
  const [selected, setSelected] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'warn'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const last = t.rounds.length;
  const current = selected && selected <= last ? selected : last;
  const round = t.rounds.find((r) => r.number === current);
  const players = useMemo(() => new Map(t.players.map((p) => [p.id, p])), [t.players]);
  const before = useMemo(() => summarize(t, current - 1), [t, current]);

  const canPairNext = last < t.totalRounds && (last === 0 || isRoundComplete(t, last));
  const done = round ? round.pairings.filter((p) => p.black === null || p.result !== null).length : 0;

  const pair = () => {
    const res = pairNextRound();
    if (res.error) setNotice({ kind: 'error', text: res.error });
    else {
      setNotice(res.warning ? { kind: 'warn', text: res.warning } : null);
      setSelected(null);
    }
  };

  const pts = (id: string) => fmtPoints(before.get(id)?.points ?? 0);

  return (
    <div className="stack">
      <section className="card no-print">
        <div className="card-head">
          <div className="round-picker">
            {t.rounds.map((r) => (
              <button key={r.number} className={r.number === current ? 'pill active' : 'pill'} onClick={() => setSelected(r.number)}>
                R{r.number}
              </button>
            ))}
            {last === 0 && <span className="hint">No rounds paired yet.</span>}
          </div>
          <div className="row round-actions">
            {last > 0 && (
              <button className="secondary" onClick={() => window.print()}>
                Print
              </button>
            )}
            {last > 0 && (
              <button
                className={confirmDelete ? 'danger' : 'ghost'}
                onBlur={() => setConfirmDelete(false)}
                onClick={() => {
                  if (!confirmDelete) return setConfirmDelete(true);
                  deleteLastRound();
                  setConfirmDelete(false);
                  setSelected(null);
                  setNotice(null);
                }}
              >
                {confirmDelete ? `Confirm: delete round ${last} and its results` : `Delete round ${last}`}
              </button>
            )}
            <button className="hide-sm" onClick={pair} disabled={!canPairNext || t.players.length < 2}>
              Pair round {last + 1}
            </button>
          </div>
        </div>
        {notice && <p className={`banner ${notice.kind}`}>{notice.text}</p>}
        {last >= t.totalRounds && <p className="hint">All {t.totalRounds} rounds paired. Add rounds in Setup if needed.</p>}
      </section>

      {round && (
        <section className="card">
          <div className="card-head">
            <h2>
              <span className="print-only">{t.name} — </span>Round {round.number}
            </h2>
            <span className="hint no-print">
              {done}/{round.pairings.length} results
            </span>
          </div>
          <div className="table-wrap">
            <table className="data pairings">
              <thead>
                <tr>
                  <th className="num">Bd</th>
                  <th className="num">Pts</th>
                  <th>White</th>
                  <th className="result-col">Result</th>
                  <th>Black</th>
                  <th className="num">Pts</th>
                </tr>
              </thead>
              <tbody>
                {round.pairings.map((pr) => (
                  <tr key={pr.board} className={pr.black && pr.result === null ? 'pending' : ''}>
                    <td className="num bd">{pr.board}</td>
                    <td className="num muted wpts">{pts(pr.white)}</td>
                    <td className="wname">
                      <span className="side w" aria-hidden />
                      {playerLabel(players.get(pr.white))}
                    </td>
                    <td className="result-col">
                      {pr.black === null ? (
                        <span className="bye-tag">bye {fmtPoints(t.system === 'roundrobin' ? 0 : t.byePoints)}</span>
                      ) : (
                        <>
                          <span className="print-only">{pr.result ?? ''}</span>
                          <div className="result-picker no-print">
                            {MAIN_RESULTS.map((r) => (
                              <button
                                key={r}
                                className={pr.result === r ? 'res active' : 'res'}
                                onClick={() => setResult(round.number, pr.board, pr.result === r ? null : r)}
                              >
                                {r}
                              </button>
                            ))}
                            <select
                              className={pr.result && !MAIN_RESULTS.includes(pr.result) ? 'res-select active' : 'res-select'}
                              value={pr.result && !MAIN_RESULTS.includes(pr.result) ? pr.result : ''}
                              onChange={(e) => setResult(round.number, pr.board, (e.target.value || null) as Result)}
                              aria-label="Forfeit result"
                            >
                              <option value="">ff…</option>
                              {FORFEITS.map((f) => (
                                <option key={f.value} value={f.value}>
                                  {f.label}
                                </option>
                              ))}
                            </select>
                            <button
                              className="ghost small"
                              title="Swap colors"
                              style={{ visibility: pr.result === null ? 'visible' : 'hidden' }}
                              onClick={() => swapColors(round.number, pr.board)}
                            >
                              ⇄
                            </button>
                          </div>
                        </>
                      )}
                    </td>
                    <td className="bname">
                      {pr.black && <span className="side b" aria-hidden />}
                      {pr.black ? playerLabel(players.get(pr.black)) : ''}
                    </td>
                    <td className="num muted bpts">{pr.black ? pts(pr.black) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {round.halfByes.length > 0 && (
            <p className="hint">Half-point byes: {round.halfByes.map((id) => players.get(id)?.name).join(', ')}</p>
          )}
        </section>
      )}

      {t.system === 'swiss' && last < t.totalRounds && (
        <section className="card no-print">
          <h2>Half-point byes for round {last + 1}</h2>
          <p className="hint">Players who asked to skip the round get ½ point and are not paired.</p>
          <div className="chips">
            {startingRank(t.players)
              .filter((p) => !p.withdrawn)
              .map((p) => (
                <label key={p.id} className={t.pendingHalfByes.includes(p.id) ? 'chip on' : 'chip'}>
                  <input type="checkbox" checked={t.pendingHalfByes.includes(p.id)} onChange={() => toggleHalfBye(p.id)} />
                  {p.name}
                </label>
              ))}
          </div>
        </section>
      )}

      {/* Mobile: the main action stays under the thumb. */}
      {t.players.length >= 2 && last < t.totalRounds && (
        <div className="mobile-actionbar no-print">
          <span className="hint">
            {round ? `Round ${last}: ${done}/${round.pairings.length} results` : `${t.players.length} players ready`}
          </span>
          <button onClick={pair} disabled={!canPairNext}>
            Pair round {last + 1}
          </button>
        </div>
      )}
    </div>
  );
}
