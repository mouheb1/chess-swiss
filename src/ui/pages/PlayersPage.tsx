import { useState, type FormEvent } from 'react';
import { startingRank } from '../../engine/scores';
import { useTournament, type NewPlayer } from '../../store/useTournament';

const blank = { name: '', rating: '', title: '', fed: '', club: '' };

/**
 * One player per line: Name, Rating, Title, Fed, Club (only name required).
 * Separator: tab if the line has one (spreadsheet paste), else ';', else ','.
 * With tab or ';' the name may itself contain a comma ("Carlsen, Magnus").
 */
function parseBulk(text: string): NewPlayer[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
      const [name, rating, title, fed, club] = line.split(sep).map((x) => x.trim());
      return { name, rating: Number(rating) || 0, title: title || undefined, fed: fed || undefined, club: club || undefined };
    })
    .filter((p) => p.name);
}

export default function PlayersPage() {
  const t = useTournament((s) => s.tournament);
  const { addPlayers, updatePlayer, removePlayer, toggleWithdrawn } = useTournament.getState();
  const [form, setForm] = useState(blank);
  const [bulk, setBulk] = useState('');
  const [error, setError] = useState<string | null>(null);
  const started = t.rounds.length > 0;
  const locked = t.system === 'roundrobin' && started;
  const players = startingRank(t.players);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const err = addPlayers([
      {
        name: form.name.trim(),
        rating: Number(form.rating) || 0,
        title: form.title.trim() || undefined,
        fed: form.fed.trim().toUpperCase() || undefined,
        club: form.club.trim() || undefined,
      },
    ]);
    setError(err);
    if (!err) setForm(blank);
  };

  const importBulk = () => {
    const list = parseBulk(bulk);
    if (!list.length) return;
    const err = addPlayers(list);
    setError(err);
    if (!err) setBulk('');
  };

  return (
    <div className="stack">
      {!locked && (
        <section className="card">
          <h2>Ajouter un joueur</h2>
          <form className="add-player" onSubmit={submit}>
            <input placeholder="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input placeholder="Elo" inputMode="numeric" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} />
            <input placeholder="Titre" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input placeholder="Féd." maxLength={3} value={form.fed} onChange={(e) => setForm({ ...form, fed: e.target.value })} />
            <input placeholder="Club" value={form.club} onChange={(e) => setForm({ ...form, club: e.target.value })} />
            <button type="submit">Ajouter</button>
          </form>
          <details className="bulk">
            <summary>Coller une liste</summary>
            <p className="hint">
              Un joueur par ligne : <code>Nom, Elo, Titre, Féd., Club</code>. Seul le nom est obligatoire. Pour les noms
              « Nom, Prénom », séparez avec <code>;</code> ou collez directement depuis un tableur.
            </p>
            <textarea rows={6} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'Magnus Carlsen, 2830, GM, NOR\nMartin, Alice; 1650'} />
            <button className="secondary" onClick={importBulk}>Ajouter {parseBulk(bulk).length || ''} joueurs</button>
          </details>
          {error && <p className="banner error">{error}</p>}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Joueurs ({t.players.length})</h2>
          {started && <span className="hint">Les joueurs déjà appariés ne peuvent pas être supprimés — retirez-les du tournoi.</span>}
        </div>
        {players.length === 0 ? (
          <p className="empty">Aucun joueur pour l'instant.</p>
        ) : (
          <div className="table-wrap">
            <table className="data players">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Nom</th>
                  <th className="num">Elo</th>
                  <th>Titre</th>
                  <th>Féd.</th>
                  <th>Club</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {players.map((p, i) => (
                  <tr key={p.id} className={p.withdrawn ? 'player-row withdrawn' : 'player-row'}>
                    <td className="num pr-no">{i + 1}</td>
                    <td className="pr-name">
                      <input className="cell" value={p.name} onChange={(e) => updatePlayer(p.id, { name: e.target.value })} aria-label="Nom" />
                    </td>
                    <td className="num pr-rating">
                      <input
                        className="cell num"
                        placeholder="Elo"
                        inputMode="numeric"
                        value={p.rating || ''}
                        onChange={(e) => updatePlayer(p.id, { rating: Number(e.target.value) || 0 })}
                        aria-label="Elo"
                      />
                    </td>
                    <td className="pr-title">
                      <input className="cell short" placeholder="Titre" value={p.title ?? ''} onChange={(e) => updatePlayer(p.id, { title: e.target.value || undefined })} aria-label="Titre" />
                    </td>
                    <td className="pr-fed">
                      <input className="cell short" placeholder="Féd." value={p.fed ?? ''} maxLength={3} onChange={(e) => updatePlayer(p.id, { fed: e.target.value.toUpperCase() || undefined })} aria-label="Fédération" />
                    </td>
                    <td className="pr-club">
                      <input className="cell" placeholder="Club" value={p.club ?? ''} onChange={(e) => updatePlayer(p.id, { club: e.target.value || undefined })} aria-label="Club" />
                    </td>
                    <td className="row-actions pr-actions">
                      <button className="ghost small" onClick={() => toggleWithdrawn(p.id)}>
                        {p.withdrawn ? 'Réintégrer' : 'Retirer'}
                      </button>
                      {!started && (
                        <button className="ghost small" onClick={() => removePlayer(p.id)} aria-label={`Supprimer ${p.name}`}>
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
