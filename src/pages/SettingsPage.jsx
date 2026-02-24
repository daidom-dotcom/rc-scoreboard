import { useState } from 'react';
import { useGame } from '../contexts/GameContext';
import ManageUsersPage from './ManageUsersPage';

export default function SettingsPage() {
  const { settings, setSettings, showAlert } = useGame();
  const [tab, setTab] = useState('quick');
  const [quickMinutes, setQuickMinutes] = useState(Math.floor(settings.quickDurationSeconds / 60));
  const [quickSeconds, setQuickSeconds] = useState(settings.quickDurationSeconds % 60);
  const [alertSeconds, setAlertSeconds] = useState(settings.alertSeconds);
  const [soundEnabled, setSoundEnabled] = useState(settings.soundEnabled);
  const [defaultTeamA, setDefaultTeamA] = useState(settings.defaultTeamA);
  const [defaultTeamB, setDefaultTeamB] = useState(settings.defaultTeamB);

  function save() {
    const duration = Math.max(0, Number(quickMinutes) * 60 + Number(quickSeconds));
    setSettings({
      ...settings,
      quickDurationSeconds: duration || 7 * 60,
      alertSeconds: Number(alertSeconds) || 20,
      soundEnabled: !!soundEnabled,
      defaultTeamA: defaultTeamA || 'Com Colete',
      defaultTeamB: defaultTeamB || 'Sem Colete'
    });
    showAlert('Configurações salvas.');
  }

  return (
    <div className="container">
      <h1 className="hTitle">Configurações</h1>

      <div className="panel tabs">
        <button className={`btn-outline ${tab === 'quick' ? 'active' : ''}`} onClick={() => setTab('quick')}>Jogo Rápido</button>
        <button className={`btn-outline ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Usuários</button>
      </div>

      {tab === 'quick' ? (
        <div className="panel">
          <div className="label">Duração padrão (Quick) mm:ss</div>
          <div className="dur-row">
            <input type="number" min="0" max="99" value={quickMinutes} onChange={(e) => setQuickMinutes(e.target.value)} />
            <div className="colon">:</div>
            <input type="number" min="0" max="59" value={quickSeconds} onChange={(e) => setQuickSeconds(e.target.value)} />
          </div>

          <div className="label">Alerta últimos segundos</div>
          <input type="number" min="0" max="99" value={alertSeconds} onChange={(e) => setAlertSeconds(e.target.value)} />

          <div className="label">Som nos últimos segundos</div>
          <select value={soundEnabled ? 'on' : 'off'} onChange={(e) => setSoundEnabled(e.target.value === 'on')}>
            <option value="on">Ativado</option>
            <option value="off">Desativado</option>
          </select>

          <div className="label">Nome Time A (Quick)</div>
          <input type="text" value={defaultTeamA} onChange={(e) => setDefaultTeamA(e.target.value)} />

          <div className="label">Nome Time B (Quick)</div>
          <input type="text" value={defaultTeamB} onChange={(e) => setDefaultTeamB(e.target.value)} />

          <div className="actions">
            <button className="btn-controle" onClick={save}>Salvar</button>
          </div>
        </div>
      ) : (
        <ManageUsersPage />
      )}
    </div>
  );
}
