import { useState, type FormEvent } from 'react';
import { cancelChoice, login, logout, resolveChoice, useSync, type SaveState } from '../store/sync';
import { useTournament } from '../store/useTournament';

const SAVE_LABEL: Record<SaveState, string> = {
  idle: 'Synchronisé',
  saving: 'Enregistrement…',
  saved: 'Enregistré',
  offline: 'Hors ligne — nouvel essai…',
  error: 'Échec de l’enregistrement — nouvel essai…',
};

/** Header control: "Mode arbitre" login for viewers, save status + logout for the arbiter. */
export function ArbiterControl() {
  const server = useSync((s) => s.server);
  const editable = useSync((s) => s.editable);
  const online = useSync((s) => s.online);
  const saveState = useSync((s) => s.saveState);
  const mode = useTournament((s) => s.mode);
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!server) return null;

  if (mode === 'arbiter') {
    return (
      <div className="arbiter-control">
        <span className={`save-badge ${saveState}`}>{SAVE_LABEL[saveState]}</span>
        <button className="ghost small" onClick={() => void logout()}>
          Quitter le mode arbitre
        </button>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await login(pin.trim());
    setBusy(false);
    setError(err);
    if (!err) {
      setPin('');
      setOpen(false);
    }
  };

  return (
    <div className="arbiter-control">
      <span className={online ? 'live-badge' : 'live-badge off'}>{online ? 'Lecture seule · mise à jour auto' : 'Connexion perdue'}</span>
      {editable && !open && (
        <button className="secondary small" onClick={() => setOpen(true)}>
          Mode arbitre
        </button>
      )}
      {open && (
        <form className="pin-form" onSubmit={submit}>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Code arbitre"
            aria-label="Code arbitre"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
          />
          <button type="submit" className="small" disabled={!pin.trim() || busy}>
            {busy ? '…' : 'Valider'}
          </button>
          <button type="button" className="ghost small" onClick={() => (setOpen(false), setError(null))}>
            Annuler
          </button>
          {error && <span className="pin-error">{error}</span>}
        </form>
      )}
    </div>
  );
}

/** Shown after login when this device and the server hold different tournaments. */
export function ChoiceDialog() {
  const choice = useSync((s) => s.choice);
  if (!choice) return null;
  const line = (c: typeof choice.server) => `« ${c.name} » — ${c.players} joueurs, ${c.rounds} ronde${c.rounds > 1 ? 's' : ''}`;
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="choice-title">
      <div className="dialog card">
        <h2 id="choice-title">Deux tournois différents</h2>
        <p>
          Le serveur contient {line(choice.server)}.
          <br />
          Cet appareil contient {line(choice.local)}.
        </p>
        <p className="hint">Lequel doit être partagé ? L’autre est gardé en sauvegarde sur cet appareil.</p>
        <div className="row">
          <button onClick={() => void resolveChoice('server')}>Garder celui du serveur</button>
          <button className="secondary" onClick={() => void resolveChoice('local')}>
            Publier celui de cet appareil
          </button>
          <button className="ghost" onClick={cancelChoice}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

export function SyncNotice() {
  const notice = useSync((s) => s.notice);
  if (!notice) return null;
  return (
    <div className="banner warn no-print notice">
      <span>{notice}</span>
      <button className="ghost small" onClick={() => useSync.setState({ notice: null })} aria-label="Fermer">
        ✕
      </button>
    </div>
  );
}
