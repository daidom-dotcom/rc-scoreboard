import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { supabase } from '../lib/supabase';
import { fetchLiveGame } from '../lib/api';
import { todayISO } from '../utils/time';
import PasswordModal from '../components/PasswordModal';

export default function GamePage() {
  const { user, isScoreboard, profile } = useAuth();
  const {
    mode,
    quarterIndex,
    totalSeconds,
    running,
    ajusteFinalAtivo,
    teamAName,
    teamBName,
    scoreA,
    scoreB,
    matchId,
    quickMatchNumber,
    settings,
    formatTime,
    startQuick,
    setDateISO,
    askConfirm,
    play,
    pause,
    addPoint,
    finishQuick,
    finishTournamentMatch,
    saveCurrentIfNeeded,
    endLiveGame,
    dateISO,
    clearGameState,
    applyLiveSnapshot
  } = useGame();

  const navigate = useNavigate();
  const label = mode === 'quick' ? `Partida ${quickMatchNumber}` : `Quarter ${quarterIndex + 1}`;

  const canEdit = !!user && isScoreboard;
  const controlsDisabled = !canEdit;
  const [teamEntries, setTeamEntries] = useState({ A: [], B: [] });
  const [liveView, setLiveView] = useState(null);
  const lastLiveAtRef = useRef(0);
  const lastGoodLiveRef = useRef(null);
  const initializedScoreboardRef = useRef(false);
  const [observerNowMs, setObserverNowMs] = useState(Date.now());
  const [passwordState, setPasswordState] = useState({ open: false, message: '', resolve: null });
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [ownTeamSide, setOwnTeamSide] = useState(null);
  const [basketEvents, setBasketEvents] = useState([]);
  const [basketReloadKey, setBasketReloadKey] = useState(0);
  const [entriesReloadKey, setEntriesReloadKey] = useState(0);
  const [selectedScorer, setSelectedScorer] = useState({ A: '', B: '' });

  function parseTimestampMs(value) {
    if (!value) return 0;
    const raw = String(value).trim();
    if (!raw) return 0;
    const normalized = raw
      .replace(' ', 'T')
      .replace(/([+-]\d{2})$/, '$1:00')
      .replace(/\.(\d{3})\d+/, '.$1')
      .replace(/\+00:00$/, 'Z');
    const ms = Date.parse(normalized);
    if (Number.isFinite(ms)) return ms;
    const fallback = Date.parse(raw);
    return Number.isFinite(fallback) ? fallback : 0;
  }

  function askPassword(message) {
    return new Promise((resolve) => {
      setPasswordState({ open: true, message, resolve });
    });
  }

  function closePasswordModal() {
    if (passwordState.resolve) passwordState.resolve(null);
    setPasswordState({ open: false, message: '', resolve: null });
  }

  function confirmPassword(value) {
    if (passwordState.resolve) passwordState.resolve(value);
    setPasswordState({ open: false, message: '', resolve: null });
  }

  useEffect(() => {
    if (!isScoreboard) return;
    if (initializedScoreboardRef.current) return;
    initializedScoreboardRef.current = true;
    let active = true;
    async function bootstrapScoreboard() {
      const today = todayISO();
      if (dateISO !== today) {
        setDateISO(today);
      }
      try {
        const live = await fetchLiveGame();
        if (!active) return;
        if (live && (live.match_id || live.match_no || live.team_a || live.team_b)) {
          applyLiveSnapshot(live);
          if (live.mode === 'quick' && !live.match_id) {
            const repairedMatchId = await ensureActiveQuickMatchId();
            if (repairedMatchId) {
              await supabase
                .from('live_game')
                .update({ match_id: repairedMatchId, updated_at: new Date().toISOString() })
                .eq('id', 1);
            }
          }
          return;
        }
      } catch {
        // fallback inicia quick padrão
      }
      if (active) startQuick();
    }
    bootstrapScoreboard();
    return () => {
      active = false;
    };
  }, [isScoreboard, dateISO, setDateISO, startQuick, applyLiveSnapshot]);

  useEffect(() => {
    const t = setInterval(() => setObserverNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let active = true;
    function applyLiveIfNewer(data) {
      if (!data) return;
      const ts = data.updated_at ? parseTimestampMs(data.updated_at) : Date.now();
      if (ts >= lastLiveAtRef.current) {
        lastLiveAtRef.current = ts;
        lastGoodLiveRef.current = data;
        setLiveView(data);
      }
    }
    async function loadLive() {
      try {
        const data = await fetchLiveGame();
        if (active && data) applyLiveIfNewer(data);
      } catch {
        // mantém o último valor para não piscar
      }
    }
    loadLive();
    const t = setInterval(loadLive, 1000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('game-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_game' },
        (payload) => {
          const live = payload?.new;
          if (!live || live.id !== 1) return;
          const ts = live.updated_at ? parseTimestampMs(live.updated_at) : Date.now();
          if (ts >= lastLiveAtRef.current) {
            lastLiveAtRef.current = ts;
            lastGoodLiveRef.current = live;
            setLiveView(live);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setTeamEntries({ A: [], B: [] });
    async function loadEntries() {
      const modeForEntries = canEdit ? mode : (liveView?.mode || lastGoodLiveRef.current?.mode || mode);
      let liveMatchId = canEdit ? (matchId || null) : (liveView?.match_id || lastGoodLiveRef.current?.match_id || null);
      if (!liveMatchId && modeForEntries === 'quick') {
        liveMatchId = await resolveActiveQuickMatchId();
      }
      if (!liveMatchId) {
        if (active) setTeamEntries({ A: [], B: [] });
        return;
      }
      const { data, error } = await supabase
        .from('player_entries')
        .select('player_name, team_side, user_id')
        .eq('match_id', liveMatchId);
      if (error) {
        if (active) setTeamEntries({ A: [], B: [] });
        return;
      }
      const a = [];
      const b = [];
      let mine = null;
      (data || []).forEach((e) => {
        const first = String(e.player_name || '').trim().split(' ')[0] || e.player_name;
        if (e.team_side === 'A') a.push(first);
        if (e.team_side === 'B') b.push(first);
        if (user?.id && e.user_id === user.id) mine = e.team_side;
      });
      if (active) {
        setTeamEntries({ A: a, B: b });
        setOwnTeamSide(mine);
        setSelectedScorer((prev) => ({
          A: (prev.A && a.includes(prev.A)) ? prev.A : '',
          B: (prev.B && b.includes(prev.B)) ? prev.B : ''
        }));
      }
    }
    loadEntries();
    const t = setInterval(loadEntries, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [canEdit, dateISO, liveView?.mode, liveView?.match_no, liveView?.match_id, matchId, mode, quickMatchNumber, entriesReloadKey]);

  useEffect(() => {
    let active = true;
    async function loadBasketEvents() {
      const liveModeForBasket = liveView?.mode || lastGoodLiveRef.current?.mode || mode;
      let currentMatchId = canEdit
        ? (matchId || liveView?.match_id || lastGoodLiveRef.current?.match_id)
        : (liveView?.match_id || lastGoodLiveRef.current?.match_id || matchId);
      const quickNoForBasket = Number(liveView?.match_no || lastGoodLiveRef.current?.match_no || quickMatchNumber || 0);
      const basketDate = canEdit ? (dateISO || todayISO()) : todayISO();
      if (!currentMatchId && liveModeForBasket === 'quick') {
        currentMatchId = await resolveActiveQuickMatchId();
      }
      let data = null;
      if (currentMatchId) {
        const byMatch = await supabase
          .from('basket_events')
          .select('id, player_name, points, created_at')
          .eq('match_id', currentMatchId)
          .order('created_at', { ascending: false });
        data = byMatch.data || [];
      }
      if ((!data || data.length === 0) && liveModeForBasket === 'quick' && quickNoForBasket > 0) {
        const byNo = await supabase
          .from('basket_events')
          .select('id, player_name, points, created_at')
          .eq('mode', 'quick')
          .eq('match_no', quickNoForBasket)
          .eq('date_iso', basketDate)
          .order('created_at', { ascending: false });
        data = byNo.data || [];
      }
      if (active) {
        setBasketEvents(data || []);
      }
    }
    loadBasketEvents();
    const t = setInterval(loadBasketEvents, 2500);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [canEdit, matchId, liveView?.match_id, liveView?.match_no, liveView?.mode, mode, basketReloadKey]);

  const safeLive = liveView || lastGoodLiveRef.current;
  const quickViewMode = (canEdit ? mode : (safeLive?.mode || mode)) === 'quick';
  const quickTeamA = (settings.defaultTeamA || 'Com Colete').trim() || 'Com Colete';
  const quickTeamB = (settings.defaultTeamB || 'Sem Colete').trim() || 'Sem Colete';
  const viewTeamA = quickViewMode ? quickTeamA : (canEdit ? teamAName : (safeLive?.team_a || teamAName));
  const viewTeamB = quickViewMode ? quickTeamB : (canEdit ? teamBName : (safeLive?.team_b || teamBName));
  const viewScoreA = canEdit ? scoreA : (safeLive?.score_a ?? scoreA);
  const viewScoreB = canEdit ? scoreB : (safeLive?.score_b ?? scoreB);
  const syncedObserverTime = useMemo(() => {
    if (!safeLive) return totalSeconds;
    const base = Number(safeLive.time_left ?? totalSeconds);
    if (safeLive.status !== 'running') return base;
    const updatedAtMs = safeLive.updated_at ? parseTimestampMs(safeLive.updated_at) : 0;
    if (!updatedAtMs) return base;
    const elapsed = Math.max(0, Math.floor((observerNowMs - updatedAtMs) / 1000));
    return Math.max(0, base - elapsed);
  }, [safeLive, totalSeconds, observerNowMs]);
  const viewTime = canEdit ? totalSeconds : syncedObserverTime;
  const safeViewTime = Number.isFinite(Number(viewTime)) ? Number(viewTime) : settings.quickDurationSeconds;
  const timerAlert = safeViewTime <= settings.alertSeconds
    && safeViewTime > 0
    && (canEdit ? running : (safeLive?.status === 'running'));
  const viewLabel = canEdit
    ? label
    : (safeLive?.mode === 'tournament'
      ? `Quarter ${safeLive?.quarter || 1}`
      : `Partida ${safeLive?.match_no || 1}`);
  const isRapidMode = (safeLive?.mode || mode) === 'quick';
  const canInteractionUser = !!user && !isScoreboard;
  const basketStats = useMemo(() => {
    const mergedEvents = [...basketEvents];
    const map = new Map();
    mergedEvents.forEach((e) => {
      const name = String(e.player_name || 'Jogador').trim();
      if (!map.has(name)) map.set(name, { one: 0, two: 0, three: 0 });
      const row = map.get(name);
      if (e.points === 1) row.one += 1;
      if (e.points === 2) row.two += 1;
      if (e.points === 3) row.three += 1;
    });
    return Array.from(map.entries())
      .map(([name, c]) => ({
        name,
        ...c,
        totalPoints: (c.one * 1) + (c.two * 2) + (c.three * 3),
        totalBaskets: c.one + c.two + c.three
      }))
      .sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
        return b.totalBaskets - a.totalBaskets;
      });
  }, [basketEvents]);

  async function resolveActiveQuickMatchId() {
    let currentMatchId = safeLive?.match_id || matchId || null;
    if (currentMatchId) return currentMatchId;
    const preferredDate = canEdit ? (dateISO || todayISO()) : todayISO();
    const liveNo = Number(safeLive?.match_no || quickMatchNumber || 0);
    if (liveNo > 0) {
      const { data: byNoDate } = await supabase
        .from('matches')
        .select('id')
        .eq('mode', 'quick')
        .eq('match_no', liveNo)
        .eq('date_iso', preferredDate)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      currentMatchId = byNoDate?.id || null;
      if (currentMatchId) return currentMatchId;
      const { data: byNoAnyDate } = await supabase
        .from('matches')
        .select('id')
        .eq('mode', 'quick')
        .eq('match_no', liveNo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      currentMatchId = byNoAnyDate?.id || null;
      if (currentMatchId) return currentMatchId;
    }
    const { data: latestQuick } = await supabase
      .from('matches')
      .select('id')
      .eq('mode', 'quick')
      .eq('status', 'pending')
      .order('date_iso', { ascending: false })
      .order('match_no', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    return latestQuick?.id || null;
  }

  async function ensureActiveQuickMatchId() {
    let currentMatchId = await resolveActiveQuickMatchId();
    if (currentMatchId) return currentMatchId;
    if (!canEdit) return null;
    const no = Number(safeLive?.match_no || quickMatchNumber || 1);
    const date = dateISO || todayISO();
    const { data: existing } = await supabase
      .from('matches')
      .select('id')
      .eq('date_iso', date)
      .eq('mode', 'quick')
      .eq('status', 'pending')
      .eq('match_no', no)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    currentMatchId = existing?.id || null;
    if (!currentMatchId) {
      const { data: created, error: createErr } = await supabase
        .from('matches')
        .insert({
          date_iso: date,
          mode: 'quick',
          team_a_name: viewTeamA || 'Com Colete',
          team_b_name: viewTeamB || 'Sem Colete',
          quarters: 1,
          durations: [settings.quickDurationSeconds || 420],
          status: 'pending',
          match_no: no
        })
        .select('id')
        .single();
      if (createErr) return null;
      currentMatchId = created?.id || null;
    }
    if (currentMatchId) {
      await supabase
        .from('live_game')
        .update({ match_id: currentMatchId, updated_at: new Date().toISOString() })
        .eq('id', 1);
    }
    return currentMatchId;
  }

  async function toggleMyTeam(side) {
    if (!user) {
      showAlert('Faça login para fazer check-in.');
      return;
    }
    if (isScoreboard) {
      showAlert('Check-in por time não é permitido no usuário placar.');
      return;
    }
    if (!isRapidMode) return;
    const currentMatchId = await resolveActiveQuickMatchId();
    if (!currentMatchId) {
      showAlert('Partida ainda não disponível para check-in.');
      return;
    }
    const targetSide = ownTeamSide === side ? null : side;
    const previousSide = ownTeamSide;
    const myFirst = String((profile?.full_name || user?.email || 'Jogador').trim()).split(' ')[0];
    setOwnTeamSide(targetSide);
    const { error: delErr } = await supabase
      .from('player_entries')
      .delete()
      .eq('match_id', currentMatchId)
      .eq('user_id', user.id);
    if (delErr) {
      setOwnTeamSide(previousSide);
      return showAlert(delErr.message || 'Erro ao atualizar check-in.');
    }
    if (!targetSide) {
      setTeamEntries((prev) => ({
        A: prev.A.filter((n) => n !== myFirst),
        B: prev.B.filter((n) => n !== myFirst)
      }));
      setEntriesReloadKey((k) => k + 1);
      return;
    }
    const { error: inErr } = await supabase
      .from('player_entries')
      .insert({
        match_id: currentMatchId,
        user_id: user.id,
        player_name: (profile?.full_name || user?.email || 'Jogador').trim(),
        team_side: targetSide,
        date_iso: dateISO || todayISO()
      });
    if (inErr) {
      setOwnTeamSide(previousSide);
      return showAlert(inErr.message || 'Erro ao atualizar check-in.');
    }
    setTeamEntries((prev) => {
      const a = prev.A.filter((n) => n !== myFirst);
      const b = prev.B.filter((n) => n !== myFirst);
      if (targetSide === 'A') a.push(myFirst);
      if (targetSide === 'B') b.push(myFirst);
      return { A: a, B: b };
    });
    setEntriesReloadKey((k) => k + 1);
  }

  async function resolveCurrentMatchIdForEvents() {
    if ((safeLive?.mode || mode) === 'tournament') {
      return safeLive?.match_id || matchId || null;
    }
    return await resolveActiveQuickMatchId();
  }

  async function registerBasketEvent(team, points) {
    if (!canEdit) return true;
    if (![1, 2, 3].includes(points)) return true;
    const side = team === 'A' ? 'A' : 'B';
    const scorer = selectedScorer[side] || 'Outros';
    const currentMatchId = await ensureActiveQuickMatchId();
    if (!currentMatchId) {
      return false;
    }
    const { data, error } = await supabase
      .from('basket_events')
      .insert({
        match_id: currentMatchId,
        date_iso: dateISO || todayISO(),
        mode: (safeLive?.mode || mode || 'quick'),
        match_no: Number(safeLive?.match_no || quickMatchNumber || null),
        team_side: side,
        player_name: scorer,
        points,
        created_by: user?.id || null
      })
      .select('id, player_name, points, created_at, team_side')
      .single();
    if (error) {
      return false;
    }
    if (data) {
      setBasketEvents((prev) => [data, ...prev]);
      setBasketReloadKey((k) => k + 1);
    }
    return true;
  }

  async function removeLastBasketEvent(team) {
    if (!canEdit) return true;
    const side = team === 'A' ? 'A' : 'B';
    const currentMatchId = await ensureActiveQuickMatchId();
    if (!currentMatchId) return false;
    const { data: latest, error } = await supabase
      .from('basket_events')
      .select('id, player_name, points, team_side, created_at')
      .eq('match_id', currentMatchId)
      .eq('team_side', side)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return false;
    if (!latest?.id) return false;
    const { error: delError } = await supabase
      .from('basket_events')
      .delete()
      .eq('id', latest.id);
    if (delError) {
      showAlert(delError.message || 'Erro ao remover cesta.');
      return false;
    }
    setBasketEvents((prev) => prev.filter((e) => e.id !== latest.id));
    setBasketReloadKey((k) => k + 1);
    return true;
  }

  async function removeBasketByPlayerAndType(playerName, points) {
    if (!canEdit) return;
    const currentMatchId = await ensureActiveQuickMatchId();
    if (!currentMatchId) return;
    const { data: latest, error } = await supabase
      .from('basket_events')
      .select('id, team_side, points, player_name, created_at')
      .eq('match_id', currentMatchId)
      .eq('player_name', playerName)
      .eq('points', points)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      showAlert(error.message || 'Erro ao buscar cesta para excluir.');
      return;
    }
    if (!latest?.id) return;
    const { error: delErr } = await supabase
      .from('basket_events')
      .delete()
      .eq('id', latest.id);
    if (delErr) {
      showAlert(delErr.message || 'Erro ao excluir cesta.');
      return;
    }
    setBasketEvents((prev) => prev.filter((e) => e.id !== latest.id));
    addPoint(latest.team_side, -Number(points));
    setBasketReloadKey((k) => k + 1);
  }

  async function handlePointButton(team, value) {
    if (!canEdit) return;
    if (value > 0) {
      const ok = await registerBasketEvent(team, value);
      if (!ok) {
        showAlert('Não foi possível salvar a cesta no banco.');
        return;
      }
      addPoint(team, value);
      return;
    }
    if (value < 0) {
      const ok = await removeLastBasketEvent(team);
      if (!ok) {
        showAlert('Não foi possível ajustar o histórico de cestas.');
        return;
      }
      addPoint(team, value);
    }
  }

  useEffect(() => {
    setBasketEvents([]);
  }, [safeLive?.match_id, safeLive?.match_no, mode, quickMatchNumber]);

  async function handleEndMatch() {
    pause();
    if (mode === 'tournament') {
      const ok = await askConfirm('Deseja encerrar a partida inteira agora?');
      if (!ok) return;
      await finishTournamentMatch(true);
      navigate('/tournament');
    } else {
      const ok = await askConfirm('Deseja encerrar a partida?');
      if (!ok) return;
      await finishQuick();
    }
  }

  async function handleSecondAction() {
    if (mode === 'tournament') {
      navigate('/tournament');
      return;
    }
    const ok = await askConfirm('Deseja encerrar o dia e ver o resumo?');
    if (!ok) return;

    if (scoreA !== 0 || scoreB !== 0) {
      const salvar = await askConfirm('Partida atual não encerrada. Deseja salvar antes de ver o resumo?');
      if (salvar) {
        await saveCurrentIfNeeded();
      }
    }

    pause();
    clearGameState();
    endLiveGame();
    navigate(`/history?summary=1&date=${dateISO}&dateTo=${dateISO}`);
  }

  async function openActionsMenuWithPassword() {
    const senha = await askPassword('Digite a senha para abrir as opções.');
    if (senha !== '834856') return;
    setActionsMenuOpen(true);
  }


  const enablePoints = running || ajusteFinalAtivo;

  return (
    <div className="game">
      <div className="center" style={{ position: 'relative' }}>
        <div className="topBar">
          <div id="partidaLabel">{viewLabel}</div>
          <div id="timer" className={timerAlert ? 'timer-alert' : ''}>{formatTime(safeViewTime)}</div>
          {canEdit ? (
            <div id="controlesJogos">
              <button className="btn-controle" onClick={play} disabled={!canEdit || running || (totalSeconds === 0 && ajusteFinalAtivo)}>PLAY</button>
              <button className="btn-controle" onClick={pause} disabled={!canEdit || !running}>STOP</button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="placar">
        <div className="frame">
          <button
            type="button"
            className={`nome nome-btn ${canInteractionUser && isRapidMode ? 'interactive' : ''} ${!!user && ownTeamSide === 'B' ? 'faded' : ''}`}
            onClick={() => toggleMyTeam('A')}
          >
            {viewTeamA}
          </button>
          {canEdit ? (
            <div className="botoes-esquerda">
              <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => handlePointButton('A', 1)}>+1</button>
              <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => handlePointButton('A', 2)}>+2</button>
              <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => handlePointButton('A', 3)}>+3</button>
              <button className="btn-ponto minus" disabled={controlsDisabled || !enablePoints} onClick={() => handlePointButton('A', -1)}>-1</button>
            </div>
          ) : null}
          <div className="pontos">{viewScoreA}</div>
          <div className="placar-checkins">
            {(teamEntries.A || []).length ? (
              canEdit ? (
                teamEntries.A.map((name, idx) => (
                  <span key={`A-${name}-${idx}`}>
                    <button
                      type="button"
                      className={`checkin-player-btn ${selectedScorer.A === name ? 'active' : ''}`}
                      onClick={() => setSelectedScorer((prev) => ({ ...prev, A: prev.A === name ? '' : name }))}
                    >
                      {name}
                    </button>
                    {idx < teamEntries.A.length - 1 ? ' / ' : ''}
                  </span>
                ))
              ) : (
                teamEntries.A.join(' / ')
              )
            ) : 'Sem check-in registrado.'}
          </div>
        </div>

        <div className="frame">
          <button
            type="button"
            className={`nome nome-btn ${canInteractionUser && isRapidMode ? 'interactive' : ''} ${!!user && ownTeamSide === 'A' ? 'faded' : ''}`}
            onClick={() => toggleMyTeam('B')}
          >
            {viewTeamB}
          </button>
          <div className="pontos">{viewScoreB}</div>
          {canEdit ? (
            <div className="botoes-direita">
              <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => handlePointButton('B', 1)}>+1</button>
              <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => handlePointButton('B', 2)}>+2</button>
              <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => handlePointButton('B', 3)}>+3</button>
              <button className="btn-ponto minus" disabled={controlsDisabled || !enablePoints} onClick={() => handlePointButton('B', -1)}>-1</button>
            </div>
          ) : null}
          <div className="placar-checkins">
            {(teamEntries.B || []).length ? (
              canEdit ? (
                teamEntries.B.map((name, idx) => (
                  <span key={`B-${name}-${idx}`}>
                    <button
                      type="button"
                      className={`checkin-player-btn ${selectedScorer.B === name ? 'active' : ''}`}
                      onClick={() => setSelectedScorer((prev) => ({ ...prev, B: prev.B === name ? '' : name }))}
                    >
                      {name}
                    </button>
                    {idx < teamEntries.B.length - 1 ? ' / ' : ''}
                  </span>
                ))
              ) : (
                teamEntries.B.join(' / ')
              )
            ) : 'Sem check-in registrado.'}
          </div>
        </div>
      </div>

      {canEdit ? (
        <div className="game-key-row">
          <button
            type="button"
            className="btn-icon game-key-btn"
            title="Opções"
            aria-label="Abrir opções"
            onClick={openActionsMenuWithPassword}
          >
            🔑
          </button>
        </div>
      ) : null}

      <details className="basket-stats-plain">
        <summary className="basket-stats-title">Cestas por jogador | Maiores pontuadores</summary>
        {!basketStats.length ? (
          <div className="basket-stats-item muted">Sem cestas registradas.</div>
        ) : (
          basketStats.map((s, idx) => (
            <div className="basket-stats-item" key={s.name}>
              {canEdit ? (
                <>
                  <span className="basket-tabbed-line">
                    {`${idx + 1}. ${s.name}:\t${s.totalPoints} pontos 🏀\t(${s.one}) 1 ponto`}
                  </span>
                  <button className="basket-del-btn" onClick={() => removeBasketByPlayerAndType(s.name, 1)}>(x)</button>
                  <span className="basket-tabbed-line">
                    {`\t(${s.two}) 2 pontos`}
                  </span>
                  <button className="basket-del-btn" onClick={() => removeBasketByPlayerAndType(s.name, 2)}>(x)</button>
                  <span className="basket-tabbed-line">
                    {`\t(${s.three}) 3 pontos`}
                  </span>
                  <button className="basket-del-btn" onClick={() => removeBasketByPlayerAndType(s.name, 3)}>(x)</button>
                </>
              ) : (
                <>
                  <strong>{idx + 1}. {s.name}: {s.totalPoints} pontos</strong>
                  {' '}🏀{' '}| ({s.one}) 1 ponto | ({s.two}) 2 pontos | ({s.three}) 3 pontos
                </>
              )}
            </div>
          ))
        )}
      </details>

      <PasswordModal
        open={passwordState.open}
        title="Senha"
        message={passwordState.message}
        onClose={closePasswordModal}
        onConfirm={confirmPassword}
      />

      {actionsMenuOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">Opções</div>
            <div className="actions">
              <button
                className="btn-controle"
                onClick={async () => {
                  setActionsMenuOpen(false);
                  await handleEndMatch();
                }}
              >
                Encerrar Partida
              </button>
              <button
                className="btn-controle"
                onClick={async () => {
                  setActionsMenuOpen(false);
                  await handleSecondAction();
                }}
              >
                Encerrar Dia
              </button>
              <button className="btn-outline" onClick={() => setActionsMenuOpen(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
