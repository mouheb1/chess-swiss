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
      return `exempt ${fmtPoints(r.points)}`;
    case 'halfbye':
      return 'exempt ½';
    case 'absent':
      return '–';
    case 'pending':
      return `${rankOf.get(r.opponent!) ?? '?'}${r.color === 'W' ? 'b' : 'n'}`;
    case 'forfeit':
      return `${rankOf.get(r.opponent!) ?? '?'}${r.color === 'W' ? 'b' : 'n'}${r.points === 1 ? '+' : '−'}`;
    default:
      return `${rankOf.get(r.opponent!) ?? '?'}${r.color === 'W' ? 'b' : 'n'}${OUTCOME(r.points)}`;
  }
}

function SwissTable({ rows, rounds }: { rows: StandingRow[]; rounds: number }) {
  const rankOf = new Map(rows.map((r, i) => [r.player.id, i + 1]));
  return (
    <table className="data crosstable sticky-cols">
      <thead>
        <tr>
          <th className="num sticky-1">Cl.</th>
          <th className="sticky-2">Nom</th>
          <th className="num hide-sm">Elo</th>
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
          <th className="num sticky-1">Cl.</th>
          <th className="sticky-2">Nom</th>
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
        <h2>Grille américaine</h2>
        <p className="empty">La grille apparaît dès que la ronde 1 est appariée.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <span className="print-only">{t.name} — </span>Grille après la ronde {upto}
        </h2>
        <div className="row no-print">
          <RoundSelect value={upto} max={t.rounds.length} onChange={setAfter} />
          <button className="secondary" onClick={() => window.print()}>
            Imprimer
          </button>
        </div>
      </div>
      <div className="table-wrap">
        {t.system === 'roundrobin' ? <RoundRobinGrid rows={rows} /> : <SwissTable rows={rows} rounds={upto} />}
      </div>
      {t.system === 'swiss' && <p className="hint">Case = rang de l'adversaire, couleur (b = Blancs, n = Noirs), résultat. + / − = forfait.</p>}
    </section>
  );
}
