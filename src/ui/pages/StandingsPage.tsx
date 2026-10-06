import { useMemo, useState } from 'react';
import { computeStandings } from '../../engine/standings';
import { TIEBREAK_LABELS, TIEBREAK_SHORT } from '../../engine/types';
import { useCurrentTournament } from '../../store/useTournament';
import { fmtPoints, fmtTiebreak, playerLabel } from '../format';

export function RoundSelect({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="inline no-print">
      Après la ronde
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function StandingsPage() {
  const t = useCurrentTournament();
  const [after, setAfter] = useState<number | null>(null);
  const upto = after && after <= t.rounds.length ? after : t.rounds.length;
  const rows = useMemo(() => computeStandings(t, upto), [t, upto]);

  if (t.rounds.length === 0) {
    return (
      <section className="card">
        <h2>Classement</h2>
        <p className="empty">Le classement apparaît dès que la ronde 1 est appariée.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <span className="print-only">{t.name} — </span>Classement après la ronde {upto}
        </h2>
        <div className="row no-print">
          <RoundSelect value={upto} max={t.rounds.length} onChange={setAfter} />
          <button className="secondary" onClick={() => window.print()}>
            Imprimer
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data standings sticky-cols">
          <thead>
            <tr>
              <th className="num sticky-1">Cl.</th>
              <th className="num hide-sm">N°</th>
              <th className="sticky-2">Nom</th>
              <th className="hide-sm">Féd.</th>
              <th className="num hide-sm">Elo</th>
              <th className="num">Pts</th>
              {t.tiebreaks.map((id) => (
                <th key={id} className="num" title={TIEBREAK_LABELS[id]}>
                  {TIEBREAK_SHORT[id]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.player.id} className={r.player.withdrawn ? 'withdrawn' : ''}>
                <td className="num sticky-1">{i > 0 && rows[i - 1].rank === r.rank ? '' : r.rank}</td>
                <td className="num muted hide-sm">{r.startRank}</td>
                <td className="sticky-2">{playerLabel(r.player)}</td>
                <td className="hide-sm">{r.player.fed ?? ''}</td>
                <td className="num hide-sm">{r.player.rating || ''}</td>
                <td className="num strong">{fmtPoints(r.points)}</td>
                {t.tiebreaks.map((id) => (
                  <td key={id} className="num">
                    {fmtTiebreak(r.tiebreaks[id])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {t.tiebreaks.map((id) => `${TIEBREAK_SHORT[id]} = ${TIEBREAK_LABELS[id]}`).join(' · ')}
      </p>
    </section>
  );
}
