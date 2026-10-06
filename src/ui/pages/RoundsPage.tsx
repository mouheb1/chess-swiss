import { useMemo, useState } from 'react';
import { isRoundComplete, startingRank, summarize } from '../../engine/scores';
import type { Player, Result, Round } from '../../engine/types';
import { useCanEdit, useCurrentTournament, useTournament } from '../../store/useTournament';
import { fmtPoints, playerLabel } from '../format';

const MAIN_RESULTS: Exclude<Result, null>[] = ['1-0', '½-½', '0-1'];
const FORFEITS: { value: Exclude<Result, null>; label: string }[] = [
  { value: '+/-', label: '+ / − (forfait, les Blancs gagnent)' },
  { value: '-/+', label: '− / + (forfait, les Noirs gagnent)' },
  { value: '0-0', label: '0 / 0 (double forfait)' },
];

interface Seat {
  player: Player;
  table: number | null;
  color: 'W' | 'B' | null;
  opponent: Player | null;
  note?: string;
}

/** Every player of the round, alphabetically, with their table — so each player finds their seat. */
function seatsByPlayer(round: Round, players: Map<string, Player>, byeLabel: string): Seat[] {
  const seats: Seat[] = [];
  for (const pr of round.pairings) {
    const white = players.get(pr.white);
    const black = pr.black ? players.get(pr.black) : undefined;
    if (white) seats.push({ player: white, table: pr.board, color: black ? 'W' : null, opponent: black ?? null, note: black ? undefined : byeLabel });
    if (black) seats.push({ player: black, table: pr.board, color: 'B', opponent: white ?? null });
  }
  for (const id of round.halfByes) {
    const p = players.get(id);
    if (p) seats.push({ player: p, table: null, color: null, opponent: null, note: 'exempt ½ point' });
  }
  return seats.sort((a, b) => a.player.name.trim().localeCompare(b.player.name.trim(), 'fr', { sensitivity: 'base' }));
}

function ByPlayerTable({ seats }: { seats: Seat[] }) {
  return (
    <table className="data by-player">
      <thead>
        <tr>
          <th>Joueur</th>
          <th className="num">Table</th>
          <th>Couleur</th>
          <th>Adversaire</th>
        </tr>
      </thead>
      <tbody>
        {seats.map((s) => (
          <tr key={s.player.id}>
            <td className="strong">{playerLabel(s.player)}</td>
            <td className="num table-no">{s.table ?? '–'}</td>
            <td className="nowrap">
              {s.color && <span className={s.color === 'W' ? 'side w' : 'side b'} aria-hidden />}
              <span className="hide-sm">{s.color === 'W' ? 'Blancs' : s.color === 'B' ? 'Noirs' : ''}</span>
            </td>
            <td>{s.opponent ? playerLabel(s.opponent) : <span className="muted">{s.note}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function RoundsPage() {
  const t = useCurrentTournament();
  const { pairNextRound, setResult, swapColors, deleteLastRound, toggleHalfBye } = useTournament.getState();
  const [selected, setSelected] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'warn'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [view, setView] = useState<'tables' | 'players'>('tables');
  const canEdit = useCanEdit();

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
            {last === 0 && <span className="hint">Aucune ronde appariée pour l'instant.</span>}
          </div>
          <div className="row round-actions">
            {last > 0 && (
              <button className="secondary" onClick={() => window.print()}>
                Imprimer
              </button>
            )}
            {canEdit && last > 0 && (
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
                {confirmDelete ? `Confirmer : supprimer la ronde ${last} et ses résultats` : `Supprimer la ronde ${last}`}
              </button>
            )}
            {canEdit && (
              <button className="hide-sm" onClick={pair} disabled={!canPairNext || t.players.length < 2}>
                Apparier la ronde {last + 1}
              </button>
            )}
          </div>
        </div>
        {notice && <p className={`banner ${notice.kind}`}>{notice.text}</p>}
        {canEdit && last >= t.totalRounds && <p className="hint">Les {t.totalRounds} rondes sont appariées. Ajoutez des rondes dans Paramètres si besoin.</p>}
      </section>

      {round && (
        <section className="card">
          <div className="card-head">
            <h2>
              <span className="print-only">{t.name} — </span>Ronde {round.number}
            </h2>
            <div className="row">
              <span className="hint no-print">
                {done}/{round.pairings.length} résultats
              </span>
              <div className="segmented no-print" role="tablist" aria-label="Affichage des appariements">
                <button role="tab" aria-selected={view === 'tables'} className={view === 'tables' ? 'active' : ''} onClick={() => setView('tables')}>
                  Par table
                </button>
                <button role="tab" aria-selected={view === 'players'} className={view === 'players' ? 'active' : ''} onClick={() => setView('players')}>
                  Par joueur
                </button>
              </div>
            </div>
          </div>
          <div className="table-wrap">
            {view === 'players' ? (
              <ByPlayerTable seats={seatsByPlayer(round, players, `exempt (${fmtPoints(t.system === 'roundrobin' ? 0 : t.byePoints)})`)} />
            ) : (
              <table className="data pairings">
                <thead>
                  <tr>
                    <th className="num">Table</th>
                    <th className="num">Pts</th>
                    <th>Blancs</th>
                    <th className="result-col">Résultat</th>
                    <th>Noirs</th>
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
                          <span className="bye-tag">exempt {fmtPoints(t.system === 'roundrobin' ? 0 : t.byePoints)}</span>
                        ) : !canEdit ? (
                          <span className="result-text">{pr.result ?? '–'}</span>
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
                                aria-label="Résultat par forfait"
                              >
                                <option value="">forf.</option>
                                {FORFEITS.map((f) => (
                                  <option key={f.value} value={f.value}>
                                    {f.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="ghost small"
                                title="Inverser les couleurs"
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
            )}
          </div>
          {view === 'tables' && round.halfByes.length > 0 && (
            <p className="hint">Exempts ½ point : {round.halfByes.map((id) => players.get(id)?.name).join(', ')}</p>
          )}
        </section>
      )}

      {canEdit && t.system === 'swiss' && last < t.totalRounds && (
        <section className="card no-print">
          <h2>Exempts ½ point pour la ronde {last + 1}</h2>
          <p className="hint">Les joueurs qui demandent à ne pas jouer cette ronde reçoivent ½ point et ne sont pas appariés.</p>
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
      {canEdit && t.players.length >= 2 && last < t.totalRounds && (
        <div className="mobile-actionbar no-print">
          <span className="hint">
            {round ? `Ronde ${last} : ${done}/${round.pairings.length} résultats` : `${t.players.length} joueurs prêts`}
          </span>
          <button onClick={pair} disabled={!canPairNext}>
            Apparier la ronde {last + 1}
          </button>
        </div>
      )}
    </div>
  );
}
