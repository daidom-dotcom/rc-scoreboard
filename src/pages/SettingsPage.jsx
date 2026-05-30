import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useGame } from '../contexts/GameContext';
import ManageUsersPage from './ManageUsersPage';
import RegisteredMatchesPage from './RegisteredMatchesPage';
import { supabase } from '../lib/supabase';
import { upsertAppSettings } from '../lib/api';
import { sanitizeSettings } from '../utils/storage';
import { todayISOInSaoPaulo } from '../utils/time';

export default function SettingsPage() {
  const { settings, setSettings, showAlert, askConfirm, dateISO, applyRemoteReset } = useGame();
  const [tab, setTab] = useState('quick');
  const [quickMinutes, setQuickMinutes] = useState(Math.floor(settings.quickDurationSeconds / 60));
  const [quickSeconds, setQuickSeconds] = useState(settings.quickDurationSeconds % 60);
  const [quickMinPlayersPerTeam, setQuickMinPlayersPerTeam] = useState(settings.quickMinPlayersPerTeam || 0);
  const [alertSeconds, setAlertSeconds] = useState(settings.alertSeconds);
  const [soundEnabled, setSoundEnabled] = useState(settings.soundEnabled);
  const [defaultTeamA, setDefaultTeamA] = useState(settings.defaultTeamA);
  const [defaultTeamB, setDefaultTeamB] = useState(settings.defaultTeamB);
  const [quickTimerScale, setQuickTimerScale] = useState(settings.quickTimerScale || 2);
  const [quickScoreScale, setQuickScoreScale] = useState(settings.quickScoreScale || 2);
  const [quickLogoScale, setQuickLogoScale] = useState(settings.quickLogoScale || 1);
  const [quickMatchLabelScale, setQuickMatchLabelScale] = useState(settings.quickMatchLabelScale || 1);
  const [quickTeamNameScale, setQuickTeamNameScale] = useState(settings.quickTeamNameScale || 1);
  const [quickPlayerNameScale, setQuickPlayerNameScale] = useState(settings.quickPlayerNameScale || 1);
  const [quickControlsScale, setQuickControlsScale] = useState(settings.quickControlsScale || 1);
  const presenceUrl = typeof window !== 'undefined' ? `${window.location.origin}/presence` : '/presence';
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(presenceUrl)}`;

  function readScale(value, fallback = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(5, Math.max(0.4, n));
  }

  async function save() {
    const duration = Math.max(0, Number(quickMinutes) * 60 + Number(quickSeconds));
    const nextSettings = sanitizeSettings({
      ...settings,
      quickDurationSeconds: duration || 7 * 60,
      quickMinPlayersPerTeam: Math.max(0, Number(quickMinPlayersPerTeam) || 0),
      alertSeconds: Number(alertSeconds) || 20,
      soundEnabled: !!soundEnabled,
      defaultTeamA: defaultTeamA || 'Com Colete',
      defaultTeamB: defaultTeamB || 'Sem Colete',
      quickTimerScale: readScale(quickTimerScale, 2),
      quickScoreScale: readScale(quickScoreScale, 2),
      quickLogoScale: readScale(quickLogoScale, 1),
      quickMatchLabelScale: readScale(quickMatchLabelScale, 1),
      quickTeamNameScale: readScale(quickTeamNameScale, 1),
      quickPlayerNameScale: readScale(quickPlayerNameScale, 1),
      quickControlsScale: readScale(quickControlsScale, 1)
    });
    try {
      const basePayload = {
        quick_duration_seconds: nextSettings.quickDurationSeconds,
        quick_min_players_per_team: nextSettings.quickMinPlayersPerTeam,
        alert_seconds: nextSettings.alertSeconds,
        sound_enabled: nextSettings.soundEnabled,
        default_team_a: nextSettings.defaultTeamA,
        default_team_b: nextSettings.defaultTeamB
      };
      const screenPayload = {
        quick_timer_scale: nextSettings.quickTimerScale,
        quick_score_scale: nextSettings.quickScoreScale,
        quick_logo_scale: nextSettings.quickLogoScale,
        quick_match_label_scale: nextSettings.quickMatchLabelScale,
        quick_team_name_scale: nextSettings.quickTeamNameScale,
        quick_player_name_scale: nextSettings.quickPlayerNameScale,
        quick_controls_scale: nextSettings.quickControlsScale
      };
      try {
        await upsertAppSettings({ ...basePayload, ...screenPayload });
      } catch (settingsError) {
        if (!String(settingsError.message || '').includes('schema cache') && !String(settingsError.message || '').includes('column')) {
          throw settingsError;
        }
        await upsertAppSettings(basePayload);
      }
      const { data: live, error: liveError } = await supabase
        .from('live_game')
        .select('id,mode,status,match_id,score_a,score_b')
        .eq('id', 1)
        .maybeSingle();
      if (liveError) throw liveError;
      const canRefreshPendingQuick = !!live
        && live.mode === 'quick'
        && live.status === 'paused'
        && Number(live.score_a || 0) === 0
        && Number(live.score_b || 0) === 0;
      if (canRefreshPendingQuick) {
        const liveUpdate = await supabase
          .from('live_game')
          .update({
            time_left: nextSettings.quickDurationSeconds,
            team_a: nextSettings.defaultTeamA,
            team_b: nextSettings.defaultTeamB,
            updated_at: new Date().toISOString()
          })
          .eq('id', 1);
        if (liveUpdate.error) throw liveUpdate.error;
        if (live.match_id) {
          const matchUpdate = await supabase
            .from('matches')
            .update({
              team_a_name: nextSettings.defaultTeamA,
              team_b_name: nextSettings.defaultTeamB,
              durations: [nextSettings.quickDurationSeconds]
            })
            .eq('id', live.match_id)
            .eq('mode', 'quick')
            .eq('status', 'pending');
          if (matchUpdate.error) throw matchUpdate.error;
        }
      }
      setSettings(nextSettings);
      showAlert('Configurações salvas.');
    } catch (err) {
      showAlert(err.message || 'Erro ao salvar configurações.');
    }
  }

  async function resetToday() {
    const ok = await askConfirm('Deseja apagar todas as partidas e check-ins de hoje?');
    if (!ok) return;
    try {
      const dayISO = todayISOInSaoPaulo();
      const startUtc = new Date(`${dayISO}T00:00:00-03:00`).toISOString();
      const endUtc = new Date(`${dayISO}T23:59:59-03:00`).toISOString();

      const attendanceByDate = await supabase.from('daily_attendance').delete().eq('date_iso', dayISO);
      if (attendanceByDate.error) throw attendanceByDate.error;
      const visitorsByDate = await supabase.from('daily_visitors').delete().eq('date_iso', dayISO);
      if (visitorsByDate.error && !String(visitorsByDate.error.message || '').includes('daily_visitors')) throw visitorsByDate.error;
      const attendanceByTimestamp = await supabase
        .from('daily_attendance')
        .delete()
        .gte('checked_at', startUtc)
        .lte('checked_at', endUtc);
      if (attendanceByTimestamp.error) throw attendanceByTimestamp.error;

      const entriesDelete = await supabase.from('player_entries').delete().eq('date_iso', dayISO);
      if (entriesDelete.error) throw entriesDelete.error;

      const { data: matchRows, error: matchesReadError } = await supabase.from('matches').select('id').eq('date_iso', dayISO);
      if (matchesReadError) throw matchesReadError;
      const ids = (matchRows || []).map((m) => m.id);
      if (ids.length) {
        const basketDelete = await supabase.from('basket_events').delete().in('match_id', ids);
        if (basketDelete.error) throw basketDelete.error;
        const resultDelete = await supabase.from('match_results').delete().in('match_id', ids);
        if (resultDelete.error) throw resultDelete.error;
      }
      const matchesDelete = await supabase.from('matches').delete().eq('date_iso', dayISO);
      if (matchesDelete.error) throw matchesDelete.error;
      const liveReset = await supabase.from('live_game').upsert({
        id: 1,
        status: 'ended',
        mode: 'quick',
        match_id: null,
        match_no: null,
        quarter: 1,
        time_left: 0,
        team_a: '',
        team_b: '',
        score_a: 0,
        score_b: 0,
        reset_at: new Date().toISOString()
      });
      if (liveReset.error) throw liveReset.error;
      applyRemoteReset();
      showAlert('Dia resetado.');
    } catch (err) {
      showAlert(err.message || 'Erro ao resetar o dia.');
    }
  }

  return (
    <div className="container">
      <h1 className="hTitle">Configurações</h1>

      <div className="panel tabs">
        <button className={`btn-outline ${tab === 'quick' ? 'active' : ''}`} onClick={() => setTab('quick')}>🏀 Jogo</button>
        <button className={`btn-outline ${tab === 'screen' ? 'active' : ''}`} onClick={() => setTab('screen')}>🖥️ Tela</button>
        <button className={`btn-outline ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>👥 Usuários</button>
        <button className={`btn-outline ${tab === 'matches' ? 'active' : ''}`} onClick={() => setTab('matches')}>Partidas</button>
        <NavLink to="/image-studio" className="btn-outline" aria-label="Gerar arte" title="Gerar arte">📷</NavLink>
      </div>

      {tab === 'quick' ? (
        <div className="panel">
          <div className="label">Duração padrão (Rápido) mm:ss</div>
          <div className="dur-row">
            <input type="number" min="0" max="99" value={quickMinutes} onChange={(e) => setQuickMinutes(e.target.value)} />
            <div className="colon">:</div>
            <input type="number" min="0" max="59" value={quickSeconds} onChange={(e) => setQuickSeconds(e.target.value)} />
          </div>

          <div className="label">Mínimo de jogadores por time para liberar PLAY</div>
          <input type="number" min="0" max="20" value={quickMinPlayersPerTeam} onChange={(e) => setQuickMinPlayersPerTeam(e.target.value)} />

          <div className="label">Alerta últimos segundos</div>
          <input type="number" min="0" max="99" value={alertSeconds} onChange={(e) => setAlertSeconds(e.target.value)} />

          <div className="label">Som nos últimos segundos</div>
          <select value={soundEnabled ? 'on' : 'off'} onChange={(e) => setSoundEnabled(e.target.value === 'on')}>
            <option value="on">Ativado</option>
            <option value="off">Desativado</option>
          </select>

          <div className="label">Nome Time A (Rápido)</div>
          <input type="text" value={defaultTeamA} onChange={(e) => setDefaultTeamA(e.target.value)} />

          <div className="label">Nome Time B (Rápido)</div>
          <input type="text" value={defaultTeamB} onChange={(e) => setDefaultTeamB(e.target.value)} />

          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn-controle" onClick={save}>Salvar</button>
            <button className="btn-outline" onClick={resetToday}>Resetar dia atual</button>
            <NavLink to="/sounds" className="btn-outline">Testar sons</NavLink>
          </div>

          <div className="panel qr-panel">
            <div className="label">QR de Presença</div>
            <img src={qrUrl} alt="QR Code de presença" className="qr-image" />
            <div className="muted">{presenceUrl}</div>
          </div>
        </div>
      ) : tab === 'screen' ? (
        <div className="panel">
          <div className="screen-settings-grid">
            <label>
              <span className="label">Cronômetro</span>
              <input type="number" min="0.4" max="5" step="0.1" value={quickTimerScale} onChange={(e) => setQuickTimerScale(e.target.value)} />
            </label>
            <label>
              <span className="label">Placar</span>
              <input type="number" min="0.4" max="5" step="0.1" value={quickScoreScale} onChange={(e) => setQuickScoreScale(e.target.value)} />
            </label>
            <label>
              <span className="label">Logo</span>
              <input type="number" min="0.4" max="5" step="0.1" value={quickLogoScale} onChange={(e) => setQuickLogoScale(e.target.value)} />
            </label>
            <label>
              <span className="label">Partida/Quarter</span>
              <input type="number" min="0.4" max="5" step="0.1" value={quickMatchLabelScale} onChange={(e) => setQuickMatchLabelScale(e.target.value)} />
            </label>
            <label>
              <span className="label">Nome dos times</span>
              <input type="number" min="0.4" max="5" step="0.1" value={quickTeamNameScale} onChange={(e) => setQuickTeamNameScale(e.target.value)} />
            </label>
            <label>
              <span className="label">Jogadores</span>
              <input type="number" min="0.4" max="5" step="0.1" value={quickPlayerNameScale} onChange={(e) => setQuickPlayerNameScale(e.target.value)} />
            </label>
            <label>
              <span className="label">Botões</span>
              <input type="number" min="0.4" max="5" step="0.1" value={quickControlsScale} onChange={(e) => setQuickControlsScale(e.target.value)} />
            </label>
          </div>
          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn-controle" onClick={save}>Salvar</button>
          </div>
        </div>
      ) : tab === 'users' ? (
        <ManageUsersPage />
      ) : (
        <RegisteredMatchesPage />
      )}
    </div>
  );
}
