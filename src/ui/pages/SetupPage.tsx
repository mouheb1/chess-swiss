import { useRef, useState } from 'react';
import { TIEBREAK_LABELS, type TiebreakId } from '../../engine/types';
import { exportJson, useCurrentTournament, useTournament } from '../../store/useTournament';

const ALL_TIEBREAKS = Object.keys(TIEBREAK_LABELS) as TiebreakId[];

export default function SetupPage() {
  const t = useCurrentTournament();
  const { updateInfo, setSystem, importJson, reset, resetRounds } = useTournament.getState();
  const shared = useTournament((s) => s.mode === 'arbiter');
  const started = t.rounds.length > 0;

  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState('');
  const [confirmRounds, setConfirmRounds] = useState(false);
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
    a.download = `${t.name.replace(/[^\w-]+/g, '_') || 'tournoi'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImport = async (file: File) => {
    const err = importJson(await file.text());
    setMsg(err ? { kind: 'error', text: err } : { kind: 'ok', text: `Fichier « ${file.name} » importé.` });
  };

  const swissRoundWarning = t.system === 'swiss' && t.players.length > 0 && t.totalRounds >= t.players.length - 2;

  return (
    <div className="stack">
      <section className="card">
        <h2>Tournoi</h2>
        <div className="grid-form">
          <label>
            Nom
            <input value={t.name} onChange={(e) => updateInfo({ name: e.target.value })} />
          </label>
          <label>
            Lieu
            <input value={t.location} onChange={(e) => updateInfo({ location: e.target.value })} />
          </label>
          <label>
            Arbitre principal
            <input value={t.arbiter} onChange={(e) => updateInfo({ arbiter: e.target.value })} />
          </label>
          <label>
            Date de début
            <input type="date" value={t.startDate} onChange={(e) => updateInfo({ startDate: e.target.value })} />
          </label>
          <label>
            Système
            <select value={t.system} disabled={started} onChange={(e) => setSystem(e.target.value as typeof t.system)}>
              <option value="swiss">Suisse (hollandais simplifié)</option>
              <option value="roundrobin">Toutes rondes (Berger)</option>
            </select>
          </label>
          <label>
            Nombre de rondes
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
              Points de l'exempt
              <select value={t.byePoints} onChange={(e) => updateInfo({ byePoints: Number(e.target.value) as 1 | 0.5 })}>
                <option value={1}>1 point</option>
                <option value={0.5}>½ point</option>
              </select>
            </label>
          )}
        </div>
        {t.system === 'roundrobin' && <p className="hint">Toutes rondes : le nombre de rondes dépend du nombre de joueurs.</p>}
        {swissRoundWarning && (
          <p className="banner warn">
            {t.totalRounds} rondes pour {t.players.length} joueurs, c'est presque un toutes rondes — les dernières rondes risquent
            d'être impossibles à apparier sans revanche. Réduisez le nombre de rondes ou passez en toutes rondes.
          </p>
        )}
      </section>

      {shared && (
        <section className="card">
          <h2>Inscriptions en ligne</h2>
          <label className="inline">
            <input type="checkbox" checked={t.registrationOpen} onChange={(e) => updateInfo({ registrationOpen: e.target.checked })} />
            Les joueurs peuvent s'inscrire depuis le site
          </label>
          <p className="hint">
            Chaque inscription attend votre validation dans l'onglet <a href="#players">Joueurs</a>. Les inscriptions se ferment
            automatiquement à l'appariement de la ronde 1 ; rouvrez-les ici pour accepter des retardataires.
          </p>
          {t.system === 'roundrobin' && started && <p className="banner warn">Le toutes rondes a commencé : plus aucune inscription possible.</p>}
        </section>
      )}

      <section className="card">
        <h2>Ordre des départages</h2>
        <ol className="tb-list">
          {t.tiebreaks.map((id, i) => (
            <li key={id}>
              <span>{TIEBREAK_LABELS[id]}</span>
              <span className="row-actions">
                <button className="ghost" onClick={() => moveTb(i, -1)} disabled={i === 0} aria-label="Monter">↑</button>
                <button className="ghost" onClick={() => moveTb(i, 1)} disabled={i === t.tiebreaks.length - 1} aria-label="Descendre">↓</button>
                <button className="ghost" onClick={() => updateInfo({ tiebreaks: t.tiebreaks.filter((x) => x !== id) })} aria-label="Retirer">✕</button>
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
        <h2>Données</h2>
        <p className="hint">
          {shared
            ? 'Tout est enregistré sur le serveur et visible par tous ceux qui ont le lien. Exportez une sauvegarde de temps en temps.'
            : 'Tout est enregistré automatiquement dans ce navigateur. Exportez une sauvegarde de temps en temps.'}
        </p>
        <div className="row">
          <button onClick={download}>Exporter (JSON)</button>
          <button className="secondary" onClick={() => fileRef.current?.click()}>Importer (JSON)</button>
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
          <h3>Nouveau tournoi avec les mêmes joueurs</h3>
          <p className="hint">Supprime toutes les rondes et tous les résultats. Les joueurs et les paramètres sont gardés.</p>
          <div className="row">
            <button
              className={confirmRounds ? 'danger' : 'secondary'}
              disabled={t.rounds.length === 0}
              onBlur={() => setConfirmRounds(false)}
              onClick={() => {
                if (!confirmRounds) return setConfirmRounds(true);
                resetRounds();
                setConfirmRounds(false);
                setMsg({ kind: 'ok', text: 'Rondes effacées, joueurs gardés.' });
              }}
            >
              {confirmRounds ? `Confirmer : effacer les ${t.rounds.length} rondes` : 'Effacer les rondes (garder les joueurs)'}
            </button>
          </div>

          <h3>Tout effacer</h3>
          <p className="hint">Supprime le tournoi, tous les joueurs et toutes les rondes. Tapez EFFACER pour confirmer.</p>
          <div className="row">
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="EFFACER" aria-label="Tapez EFFACER pour confirmer" />
            <button
              className="danger"
              disabled={confirm !== 'EFFACER'}
              onClick={() => {
                reset();
                setConfirm('');
                setMsg({ kind: 'ok', text: 'Tournoi réinitialisé.' });
              }}
            >
              Tout effacer
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
