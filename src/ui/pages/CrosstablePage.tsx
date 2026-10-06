import { useMemo, useState } from 'react';
import type { RoundRecord } from '../../engine/scores';
import { computeStandings, type StandingRow } from '../../engine/standings';
import { useTournament } from '../../store/useTournament';
import { fmtPoints, playerLabel } from '../format';
import { RoundSelect } from './StandingsPage';

const OUTCOME = (pts: number) => (pts === 1 ? '1' : pts === 0.5 ? '½' : '0');

/** Swiss-Manager style cell: opponent rank + color + result, e.g. "12w1". */
function swissCell(r: RoundRecord, rankOf: Map<string, number>): string {
  switch (r.kind) {
    case 'bye':
      return `bye ${fmtPoints(r.points)}`;
    case 'halfbye':
      return '½ bye';
    case 'absent':
      return '–';
    case 'pending':
      return `${rankOf.get(r.opponent!) ?? '?'}${r.color === 'W' ? 'w' : 'b'}`;
    case 'forfeit':
      return `${rankOf.get(r.opponent!) ?? '?'}${r.color === 'W' ? 'w' : 'b'}${r.points === 1 ? '+' : '−'}`;
    default:
      return `${rankOf.get(r.opponent!) ?? '?'}${r.color === 'W' ? 'w' : 'b'}${OUTCOME(r.points)}`;
  }
}

function SwissTable({ rows, rounds }: { rows: StandingRow[]; rounds: number }) {
  const rankOf = new Map(rows.map((r, i) => [r.player.id, i + 1]));
  return (
    <table className="data crosstable sticky-cols">
      <thead>
        <tr>
          <th className="num sticky-1">Rk</th>
          <th className="sticky-2">Name</th>
          <th className="num hide-sm">Rating</th>
          {Array.from({ length: rounds }, (_, i) => (
            <th key={i} className="center">
              R{i + 1}
            </th>
          ))}
          <th className="num">Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.player.id} className={r.player.withdrawn ? 'withdrawn' : ''}>
            <td className="num sticky-1">{i + 1}</td>
            <td className="sticky-2">{playerLabel(r.player)}</td>
            <td className="num hide-sm">{r.player.rating || ''}</td>
            {r.summary.records.map((rec) => (
              <td key={rec.round} className="center mono">
                {swissCell(rec, rankOf)}
              </td>
            ))}
            <td className="num strong">{fmtPoints(r.points)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RoundRobinGrid({ rows }: { rows: StandingRow[] }) {
  const index = new Map(rows.map((r, i) => [r.player.id, i]));
  return (
    <table className="data crosstable grid sticky-cols">
      <thead>
        <tr>
          <th className="num sticky-1">Rk</th>
          <th className="sticky-2">Name</th>
          {rows.map((_, i) => (
            <th key={i} className="center">
              {i + 1}
            </th>
          ))}
          <th className="num">Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const cells: string[] = rows.map(() => '');
          for (const rec of r.summary.records) {
            if (!rec.opponent) continue;
            const j = index.get(rec.opponent);
            if (j === undefined) continue;
            const v = rec.kind === 'pending' ? '·' : rec.kind === 'forfeit' ? (rec.points === 1 ? '+' : '−') : OUTCOME(rec.points);
            cells[j] = cells[j] ? `${cells[j]} ${v}` : v;
          }
          return (
            <tr key={r.player.id}>
              <td className="num sticky-1">{i + 1}</td>
              <td className="sticky-2">{playerLabel(r.player)}</td>
              {cells.map((c, j) => (
                <td key={j} className={i === j ? 'center diag' : 'center mono'}>
                  {c}
                </td>
              ))}
              <td className="num strong">{fmtPoints(r.points)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function CrosstablePage() {
  const t = useTournament((s) => s.tournament);
  const [after, setAfter] = useState<number | null>(null);
  const upto = after && after <= t.rounds.length ? after : t.rounds.length;
  const rows = useMemo(() => computeStandings(t, upto), [t, upto]);

  if (t.rounds.length === 0) {
    return (
      <section className="card">
        <h2>Crosstable</h2>
        <p className="empty">The crosstable appears once round 1 is paired.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <span className="print-only">{t.name} — </span>Crosstable after round {upto}
        </h2>
        <div className="row no-print">
          <RoundSelect value={upto} max={t.rounds.length} onChange={setAfter} />
          <button className="secondary" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>
      <div className="table-wrap">
        {t.system === 'roundrobin' ? <RoundRobinGrid rows={rows} /> : <SwissTable rows={rows} rounds={upto} />}
      </div>
      {t.system === 'swiss' && <p className="hint">Cell = opponent's rank, color (w/b), result. + / − = forfeit.</p>}
    </section>
  );
}
