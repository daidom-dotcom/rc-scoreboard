import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { supabase } from '../lib/supabase';
import { fetchDailyAttendance, fetchLiveGame } from '../lib/api';
import { todayISOInSaoPaulo } from '../utils/time';
import PasswordModal from '../components/PasswordModal';
import { preferredDisplayName } from '../utils/names';

export default function GamePage() {
  const { user, isScoreboard, profile } = useAuth();
  const {
    mode,
    quarterIndex,
    currentMatchQuarters,
    overtimeCount,
    currentTournamentId,
    tournamentSummaryTarget,
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
    startTournamentMatch,
    setDateISO,
    askConfirm,
    showAlert,
    setTournamentSummaryTarget,
    play,
    pause,
    addPoint,
    finishQuick,
    finishTournamentMatch,
    saveCurrentIfNeeded,
    endLiveGame,
    dateISO,
    clearGameState,
    applyLiveSnapshot,
    debugTrail,
    logDebug
  } = useGame();

  const navigate = useNavigate();
  const location = useLocation();
  const label = mode === 'quick'
    ? `Partida ${quickMatchNumber}`
    : (quarterIndex < currentMatchQuarters ? `Quarter ${quarterIndex + 1}` : `P${overtimeCount || Math.max(1, quarterIndex - currentMatchQuarters + 1)}`);

  const canEdit = !!user && isScoreboard;
  const [teamEntryRows, setTeamEntryRows] = useState({ A: [], B: [] });
  const [liveView, setLiveView] = useState(null);
  const lastLiveAtRef = useRef(0);
  const lastGoodLiveRef = useRef(null);
  const initializedScoreboardRef = useRef(false);
  const quickFallbackStartedRef = useRef(false);
  const entriesRequestRef = useRef(0);
  const startQuickRef = useRef(startQuick);
  const applyLiveSnapshotRef = useRef(applyLiveSnapshot);
  const logDebugRef = useRef(logDebug);
  const [observerNowMs, setObserverNowMs] = useState(Date.now());
  const [passwordState, setPasswordState] = useState({ open: false, message: '', resolve: null });
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [basketEvents, setBasketEvents] = useState([]);
  const [basketReloadKey, setBasketReloadKey] = useState(0);
  const [entriesReloadKey, setEntriesReloadKey] = useState(0);
  const [entriesDebug, setEntriesDebug] = useState({ matchId: null, count: 0, error: null, namesA: [], namesB: [] });
  const [attendanceList, setAttendanceList] = useState([]);
  const [assignmentSide, setAssignmentSide] = useState(null);
  const [scoringPrompt, setScoringPrompt] = useState({ open: false, team: null, entry: null });

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

  function formatAttendanceName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0];
    const firstName = parts[0];
    const surnameInitial = parts[1].charAt(0).toUpperCase();
    return surnameInitial ? `${firstName} ${surnameInitial}.` : firstName;
  }

  function buildAttendanceKey(person) {
    if (person?.attendee_key) return person.attendee_key;
    if (person?.user_id) return `user:${person.user_id}`;
    return `guest:${String(person?.player_name || '').trim().toLowerCase()}`;
  }

  function formatBasketPlayerName(rawName) {
    const normalizedRaw = String(rawName || '').trim();
    if (!normalizedRaw) return 'Jogador';
    if (normalizedRaw === 'Outros') return 'Outros';
    const normalizedFirst = normalizedRaw.split(/\s+/)[0] || '';
    const allEntries = [...(teamEntryRows.A || []), ...(teamEntryRows.B || [])];
    const matched = allEntries.find((entry) => (
      entry.player_name === normalizedRaw
      || entry.firstName === normalizedRaw
      || entry.shortName === normalizedRaw
      || entry.nickname === normalizedRaw
      || entry.fullName === normalizedRaw
      || entry.email === normalizedRaw
      || String(entry.player_name || '').trim().split(/\s+/)[0] === normalizedRaw
      || String(entry.fullName || '').trim().split(/\s+/)[0] === normalizedFirst
      || String(entry.nickname || '').trim() === normalizedFirst
    ));
    if (matched?.shortName) return matched.shortName;
    if (matched?.player_name) return formatAttendanceName(matched.player_name);
    if (normalizedRaw.includes('@')) {
      const local = normalizedRaw.split('@')[0] || normalizedRaw;
      const parts = local.split(/[._-]+/).filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)} ${parts[1].charAt(0).toUpperCase()}.`;
      }
      return parts[0] ? `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}` : normalizedRaw;
    }
    return formatAttendanceName(normalizedRaw);
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
    startQuickRef.current = startQuick;
    applyLiveSnapshotRef.current = applyLiveSnapshot;
    logDebugRef.current = logDebug;
  }, [startQuick, applyLiveSnapshot, logDebug]);

  useEffect(() => {
    if (!tournamentSummaryTarget) return;
    navigate(`/history?tournament=${tournamentSummaryTarget}&summary=1`, { replace: true });
    setTournamentSummaryTarget(null);
  }, [tournamentSummaryTarget, navigate, setTournamentSummaryTarget]);

  useEffect(() => {
    const navMatch = location.state?.tournamentMatch;
    if (!navMatch?.id) return;
    let active = true;
    async function applyTournamentNavigation() {
      await startTournamentMatch(navMatch);
      if (active) {
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
    applyTournamentNavigation();
    return () => {
      active = false;
    };
  }, [location.state, location.pathname, navigate, startTournamentMatch]);

  useEffect(() => {
    if (!isScoreboard) return;
    if (initializedScoreboardRef.current) return;
    initializedScoreboardRef.current = true;
    let active = true;
    async function bootstrapScoreboard() {
      if (location.state?.tournamentMatch?.id) {
        logDebugRef.current('GamePage.bootstrap.skipForTournamentNavigation', { matchId: location.state.tournamentMatch.id });
        return;
      }
      if (mode === 'tournament' && matchId) {
        logDebugRef.current('GamePage.bootstrap.keepTournamentState', { matchId, quarterIndex: quarterIndex + 1 });
        return;
      }
      const today = todayISOInSaoPaulo();
      logDebugRef.current('GamePage.bootstrap.begin', { today, dateISO });
      if (dateISO !== today) {
        setDateISO(today);
      }
      try {
        const live = await fetchLiveGame();
        if (!active) return;
        const liveIsValidQuick = !(live?.mode === 'quick' && !live?.match_id);
        const hasLivePayload = !!(live && liveIsValidQuick && (live.match_id || live.match_no || live.team_a || live.team_b));
        const defaultQuickSeconds = Number(settings.quickDurationSeconds || 420);
        const liveQuickSeconds = Number(live?.time_left || 0);
        const quickInProgress = !!live && live.mode === 'quick' && liveQuickSeconds > 0 && liveQuickSeconds < defaultQuickSeconds;
        const shouldRestoreLive = !!live && (
          (live.mode === 'quick' ? quickInProgress : true)
        );
        if (live && !liveIsValidQuick) {
          logDebugRef.current('GamePage.bootstrap.ignoreInvalidQuickLive', {
            match_id: live.match_id || null,
            match_no: live.match_no || null,
            status: live.status || null
          });
        }
        if (hasLivePayload && shouldRestoreLive) {
          logDebugRef.current('GamePage.bootstrap.restoreLive', {
            mode: live.mode,
            match_id: live.match_id,
            match_no: live.match_no,
            time_left: live.time_left
          });
          applyLiveSnapshotRef.current(live);
          return;
        }
      } catch {
        logDebugRef.current('GamePage.bootstrap.liveFetchFailed');
        // fallback inicia quick padrão
      }
      if (active) {
        try {
          await startQuickRef.current();
          logDebugRef.current('GamePage.bootstrap.startedQuick');
        } catch {
          logDebugRef.current('GamePage.bootstrap.startQuickFailed');
          // deixa a tela viva, mas sem quebrar a montagem
        }
      }
    }
    bootstrapScoreboard();
    return () => {
      active = false;
    };
  }, [isScoreboard, dateISO, setDateISO, mode, matchId, quarterIndex, location.state]);

  useEffect(() => {
    if (!isScoreboard) return;
    if (location.state?.tournamentMatch?.id) return;
    if (mode === 'tournament' || liveView?.mode === 'tournament') return;
    if (mode !== 'quick') return;
    if (matchId) return;
    if (liveView?.match_id) return;
    if (quickFallbackStartedRef.current) return;
    quickFallbackStartedRef.current = true;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      logDebugRef.current('GamePage.quickFallback.begin', { dateISO, quickMatchNumber });
      try {
        await startQuickRef.current();
        logDebugRef.current('GamePage.quickFallback.success');
      } catch (err) {
        logDebugRef.current('GamePage.quickFallback.error', err?.message || 'unknown');
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isScoreboard, mode, matchId, liveView?.match_id, dateISO, quickMatchNumber]);

  useEffect(() => {
    if (matchId || liveView?.match_id) {
      quickFallbackStartedRef.current = false;
    }
  }, [matchId, liveView?.match_id]);

  useEffect(() => {
    const t = setInterval(() => setObserverNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadAttendance() {
      try {
        const data = await fetchDailyAttendance(dateISO || todayISOInSaoPaulo());
        if (active) setAttendanceList(data || []);
      } catch {
        if (active) setAttendanceList([]);
      }
    }
    loadAttendance();
    const t = setInterval(loadAttendance, 3000);
  const channel = supabase
      .channel('daily-attendance-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_attendance' },
        () => loadAttendance()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_visitors' },
        () => loadAttendance()
      )
      .subscribe();
    return () => {
      active = false;
      clearInterval(t);
      supabase.removeChannel(channel);
    };
  }, [dateISO]);

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
            if (
              isScoreboard &&
              live.mode === 'tournament' &&
              live.match_id &&
              (mode !== 'tournament' || matchId !== live.match_id)
            ) {
              applyLiveSnapshotRef.current(live);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isScoreboard, mode, matchId]);

  useEffect(() => {
    let active = true;
    const requestId = ++entriesRequestRef.current;
    async function loadEntries() {
      const modeForEntries = canEdit ? mode : (liveView?.mode || lastGoodLiveRef.current?.mode || mode);
      let liveMatchId = canEdit
        ? (matchId || liveView?.match_id || lastGoodLiveRef.current?.match_id || null)
        : (liveView?.match_id || lastGoodLiveRef.current?.match_id || matchId || null);
      if (!liveMatchId && modeForEntries === 'quick') {
        liveMatchId = await resolveActiveQuickMatchId();
      }
        if (!liveMatchId) {
          if (active && requestId === entriesRequestRef.current) {
            setTeamEntryRows({ A: [], B: [] });
            setEntriesDebug({ matchId: null, count: 0, error: null, namesA: [], namesB: [] });
          }
          return;
        }
      const { data, error } = await supabase
        .from('player_entries')
        .select('player_name, team_side, user_id')
        .eq('match_id', liveMatchId);
      if (error) {
        if (active && requestId === entriesRequestRef.current) {
          setTeamEntryRows({ A: [], B: [] });
          setEntriesDebug({ matchId: liveMatchId, count: 0, error: error.message || 'unknown', namesA: [], namesB: [] });
        }
        return;
      }
      const userIds = (data || []).map((entry) => entry.user_id).filter(Boolean);
      const { data: profiles } = userIds.length
        ? await supabase
          .from('profiles')
          .select('id,full_name,nickname,email')
          .in('id', userIds)
        : { data: [], error: null };
      const profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
      const a = [];
      const b = [];
      const rowsA = [];
      const rowsB = [];
      (data || []).forEach((e) => {
        const profileData = profilesById.get(e.user_id) || null;
        const displayName = preferredDisplayName(profileData) || e.player_name;
        const first = String(displayName || '').trim().split(' ')[0] || displayName;
        const shortName = formatAttendanceName(displayName);
        const normalized = {
          user_id: e.user_id,
          player_name: displayName,
          fullName: String(profileData?.full_name || '').trim(),
          nickname: String(profileData?.nickname || '').trim(),
          email: String(profileData?.email || '').trim(),
          firstName: first,
          shortName,
          attendeeKey: e.user_id ? `user:${e.user_id}` : `guest:${String(e.player_name || '').trim().toLowerCase()}`
        };
        if (e.team_side === 'A') {
          a.push(shortName);
          rowsA.push(normalized);
        }
        if (e.team_side === 'B') {
          b.push(shortName);
          rowsB.push(normalized);
        }
      });
      if (active && requestId === entriesRequestRef.current) {
        setTeamEntryRows({ A: rowsA, B: rowsB });
        setEntriesDebug({ matchId: liveMatchId, count: (data || []).length, error: null, namesA: a, namesB: b });
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
    setAssignmentSide(null);
    setScoringPrompt({ open: false, team: null, entry: null });
  }, [matchId, liveView?.match_id, quickMatchNumber]);

  useEffect(() => {
    const channel = supabase
      .channel('player-entries-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'player_entries' },
        () => {
          setEntriesReloadKey((k) => k + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadBasketEvents() {
      let currentMatchId = canEdit
        ? (matchId || liveView?.match_id || lastGoodLiveRef.current?.match_id)
        : (liveView?.match_id || lastGoodLiveRef.current?.match_id || matchId);
      if (!currentMatchId) {
        if (active) setBasketEvents([]);
        return;
      }
      const byMatch = await supabase
        .from('basket_events')
        .select('id, player_name, points, created_at')
        .eq('match_id', currentMatchId)
        .order('created_at', { ascending: false });
      const data = byMatch.data || [];
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

  const rawLive = liveView || lastGoodLiveRef.current;
  const safeLive = rawLive && rawLive.mode === 'quick' && !rawLive.match_id ? null : rawLive;
  const quickViewMode = (canEdit ? mode : (safeLive?.mode || mode)) === 'quick';
  const quickTeamA = (settings.defaultTeamA || 'Com Colete').trim() || 'Com Colete';
  const quickTeamB = (settings.defaultTeamB || 'Sem Colete').trim() || 'Sem Colete';
  const liveModeForView = safeLive?.mode || mode;
  const viewTeamA = quickViewMode
    ? quickTeamA
    : (liveModeForView === 'tournament' ? (safeLive?.team_a || teamAName) : (canEdit ? teamAName : (safeLive?.team_a || teamAName)));
  const viewTeamB = quickViewMode
    ? quickTeamB
    : (liveModeForView === 'tournament' ? (safeLive?.team_b || teamBName) : (canEdit ? teamBName : (safeLive?.team_b || teamBName)));
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
  const teamEntries = useMemo(() => ({
    A: (teamEntryRows.A || []).map((entry) => entry.shortName || formatAttendanceName(entry.player_name) || entry.firstName),
    B: (teamEntryRows.B || []).map((entry) => entry.shortName || formatAttendanceName(entry.player_name) || entry.firstName)
  }), [teamEntryRows]);
  const assignedSideByAttendanceKey = useMemo(() => {
    const map = new Map();
    (teamEntryRows.A || []).forEach((entry) => {
      if (entry.attendeeKey) map.set(entry.attendeeKey, 'A');
    });
    (teamEntryRows.B || []).forEach((entry) => {
      if (entry.attendeeKey) map.set(entry.attendeeKey, 'B');
    });
    return map;
  }, [teamEntryRows]);
  const availableAttendanceList = useMemo(
    () => attendanceList.filter((person) => !assignedSideByAttendanceKey.has(buildAttendanceKey(person))),
    [attendanceList, assignedSideByAttendanceKey]
  );
  const minPlayersPerTeam = Math.max(0, Number(settings.quickMinPlayersPerTeam || 0));
  const quickReadyToPlay = !isRapidMode || minPlayersPerTeam === 0 || ((teamEntryRows.A || []).length >= minPlayersPerTeam && (teamEntryRows.B || []).length >= minPlayersPerTeam);
  const basketStats = useMemo(() => {
    const mergedEvents = [...basketEvents];
    const map = new Map();
    mergedEvents.forEach((e) => {
      const name = formatBasketPlayerName(e.player_name);
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
  }, [basketEvents, teamEntryRows]);

  async function resolveActiveQuickMatchId() {
    let currentMatchId = safeLive?.match_id || matchId || null;
    if (currentMatchId) return currentMatchId;
    const preferredDate = dateISO || todayISOInSaoPaulo();
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
    }
    return null;
  }

  async function ensureActiveQuickMatchId() {
    return await resolveActiveQuickMatchId();
  }

  async function assignAttendanceToTeam(person, side) {
    const currentMatchId = await resolveCurrentMatchIdForEvents();
    if (!currentMatchId) {
      showAlert('Partida ainda não disponível.');
      return;
    }
    try {
      let clearQuery = supabase
        .from('player_entries')
        .delete()
        .eq('match_id', currentMatchId);
      clearQuery = person.user_id
        ? clearQuery.eq('user_id', person.user_id)
        : clearQuery.is('user_id', null).eq('player_name', person.player_name);
      const { error: clearSelectedError } = await clearQuery;
      if (clearSelectedError) throw clearSelectedError;

      const { error: insertError } = await supabase
        .from('player_entries')
        .insert({
          match_id: currentMatchId,
          user_id: person.user_id,
          player_name: person.player_name,
          team_side: side,
          date_iso: dateISO || todayISOInSaoPaulo()
        });
      if (insertError) throw insertError;
      const firstName = String(person.player_name || '').trim().split(' ')[0] || person.player_name;
      const shortName = formatAttendanceName(person.player_name);
      const normalized = {
        user_id: person.user_id,
        player_name: person.player_name,
        firstName,
        shortName,
        attendeeKey: buildAttendanceKey(person)
      };
      setTeamEntryRows((prev) => {
        const targetKey = buildAttendanceKey(person);
        const nextA = (prev.A || []).filter((entry) => entry.attendeeKey !== targetKey);
        const nextB = (prev.B || []).filter((entry) => entry.attendeeKey !== targetKey);
        if (side === 'A') nextA.push(normalized);
        if (side === 'B') nextB.push(normalized);
        return { A: nextA, B: nextB };
      });
      setEntriesReloadKey((k) => k + 1);
    } catch (err) {
      showAlert(err.message || 'Erro ao salvar time.');
    }
  }

  async function removePlayerFromTeam(entry) {
    if (!canEdit || !entry) return;
    const currentMatchId = await resolveCurrentMatchIdForEvents();
    if (!currentMatchId) return;
    try {
      let removeQuery = supabase
        .from('player_entries')
        .delete()
        .eq('match_id', currentMatchId);
      removeQuery = entry.user_id
        ? removeQuery.eq('user_id', entry.user_id)
        : removeQuery.is('user_id', null).eq('player_name', entry.player_name);
      const { error } = await removeQuery;
      if (error) throw error;
      setTeamEntryRows((prev) => ({
        A: (prev.A || []).filter((item) => item.attendeeKey !== entry.attendeeKey),
        B: (prev.B || []).filter((item) => item.attendeeKey !== entry.attendeeKey)
      }));
      setEntriesReloadKey((k) => k + 1);
    } catch (err) {
      showAlert(err.message || 'Erro ao remover jogador do time.');
    }
  }

  async function removeAllPlayersFromTeam(side) {
    if (!canEdit || !['A', 'B'].includes(side)) return;
    const currentMatchId = await resolveCurrentMatchIdForEvents();
    if (!currentMatchId) return;
    try {
      const { error } = await supabase
        .from('player_entries')
        .delete()
        .eq('match_id', currentMatchId)
        .eq('team_side', side);
      if (error) throw error;
      setTeamEntryRows((prev) => ({
        ...prev,
        [side]: []
      }));
      setEntriesReloadKey((k) => k + 1);
    } catch (err) {
      showAlert(err.message || 'Erro ao remover jogadores do time.');
    }
  }

  async function resolveCurrentMatchIdForEvents() {
    if ((safeLive?.mode || mode) === 'tournament') {
      return safeLive?.match_id || matchId || null;
    }
    return await resolveActiveQuickMatchId();
  }

  async function registerBasketEvent(team, points, scorerName) {
    if (!canEdit) return true;
    if (![1, 2, 3].includes(points)) return true;
    const side = team === 'A' ? 'A' : 'B';
    const scorer = scorerName || 'Outros';
    const currentMatchId = await ensureActiveQuickMatchId();
    if (!currentMatchId) {
      return false;
    }
    const { data, error } = await supabase
      .from('basket_events')
        .insert({
        match_id: currentMatchId,
        date_iso: dateISO || todayISOInSaoPaulo(),
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

  function openScoringPrompt(team, entry) {
    if (!canEdit || !enablePoints) return;
    setScoringPrompt({ open: true, team, entry });
  }

  async function handleScoreChoice(points) {
    if (!scoringPrompt.open || !scoringPrompt.team || !scoringPrompt.entry) return;
    const ok = await registerBasketEvent(scoringPrompt.team, points, scoringPrompt.entry.player_name);
    if (!ok) {
      showAlert('Não foi possível salvar a cesta no banco.');
      return;
    }
    addPoint(scoringPrompt.team, points);
    setScoringPrompt({ open: false, team: null, entry: null });
  }

  useEffect(() => {
    setBasketEvents([]);
  }, [safeLive?.match_id, safeLive?.match_no, mode, quickMatchNumber]);

  async function handleEndMatch() {
    pause();
    if (mode === 'tournament') {
      const ok = await askConfirm('Deseja encerrar a partida inteira agora?');
      if (!ok) return;
      const startedNext = await finishTournamentMatch(true);
      if (!startedNext) {
        navigate(currentTournamentId ? `/history?tournament=${currentTournamentId}&summary=1` : '/tournament');
      }
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
    const startUtc = new Date(`${dateISO}T00:00:00-03:00`).toISOString();
    const endUtc = new Date(`${dateISO}T23:59:59-03:00`).toISOString();
    await supabase.from('daily_attendance').delete().eq('date_iso', dateISO);
    const visitorsDelete = await supabase.from('daily_visitors').delete().eq('date_iso', dateISO);
    if (visitorsDelete.error && !String(visitorsDelete.error.message || '').includes('daily_visitors')) throw visitorsDelete.error;
    await supabase.from('daily_attendance').delete().gte('checked_at', startUtc).lte('checked_at', endUtc);
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
  const fmtBasketCount = (value) => String(Number(value || 0)).padStart(2, '0');
  const playDisabled = !canEdit || running || (totalSeconds === 0 && ajusteFinalAtivo) || (isRapidMode && !quickReadyToPlay);

  return (
    <div className="game">
      <div className="center" style={{ position: 'relative' }}>
        <div className="game-main-row">
          <div className="game-logo-slot">
            <img src="/logo.png" alt="Logo Rachão dos Crias" className="game-logo-img" />
          </div>
          <div className="game-info-col">
            <div className="game-title-center">{viewLabel}</div>
            <div className="game-head">
              <div id="timer" className={timerAlert ? 'timer-alert' : ''}>{formatTime(safeViewTime)}</div>
              {canEdit ? (
                <div id="controlesJogos">
                  <button className="btn-controle" onClick={play} disabled={playDisabled}>PLAY</button>
                  <button className="btn-controle" onClick={pause} disabled={!canEdit || !running}>STOP</button>
                </div>
              ) : null}
            </div>
            {canEdit && isRapidMode && minPlayersPerTeam > 0 && !quickReadyToPlay ? (
              <div className="game-play-hint">PLAY libera com pelo menos {minPlayersPerTeam} jogador(es) em cada time.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="placar">
        <div className="team-panel">
          <button
            type="button"
            className={`nome nome-btn team-title-btn left ${canEdit ? 'interactive' : ''} ${assignmentSide === 'A' ? 'selected-target' : ''} ${assignmentSide === 'B' ? 'faded' : ''}`}
            onClick={() => canEdit && setAssignmentSide((prev) => prev === 'A' ? null : 'A')}
          >
            {viewTeamA}
          </button>
          <div className="frame">
          <div className="frame-body">
            <div className="pontos">{viewScoreA}</div>
          </div>
          <div className="frame-footer">
            <div className="placar-checkins">
              {(teamEntries.A || []).length ? (
                canEdit ? (
                  teamEntryRows.A.map((entry, idx) => (
                    <span key={`A-${entry.attendeeKey || entry.user_id || entry.firstName}-${idx}`}>
                      <button
                        type="button"
                        className="checkin-player-btn"
                        onClick={() => openScoringPrompt('A', entry)}
                      >
                        {entry.shortName || entry.firstName}
                      </button>
                      <button
                        type="button"
                        className="checkin-player-remove"
                        onClick={() => removePlayerFromTeam(entry)}
                        title={`Remover ${entry.shortName || entry.firstName}`}
                        aria-label={`Remover ${entry.shortName || entry.firstName}`}
                      >
                        ❌
                      </button>
                      {idx < teamEntryRows.A.length - 1 ? ' / ' : ''}
                    </span>
                  ))
                ) : (
                  teamEntries.A.join(' / ')
                )
              ) : 'Sem check-in registrado.'}
            </div>
            {canEdit && (teamEntryRows.A || []).length ? (
              <button
                type="button"
                className="team-clear-btn"
                onClick={() => removeAllPlayersFromTeam('A')}
                title={`Remover todos de ${viewTeamA}`}
                aria-label={`Remover todos de ${viewTeamA}`}
              >
                remover todos
              </button>
            ) : null}
          </div>
        </div>
        </div>

        <div className="team-panel">
          <button
            type="button"
            className={`nome nome-btn team-title-btn right ${canEdit ? 'interactive' : ''} ${assignmentSide === 'B' ? 'selected-target' : ''} ${assignmentSide === 'A' ? 'faded' : ''}`}
            onClick={() => canEdit && setAssignmentSide((prev) => prev === 'B' ? null : 'B')}
          >
            {viewTeamB}
          </button>
          <div className="frame">
          <div className="frame-body">
            <div className="pontos">{viewScoreB}</div>
          </div>
          <div className="frame-footer">
            <div className="placar-checkins">
              {(teamEntries.B || []).length ? (
                canEdit ? (
                  teamEntryRows.B.map((entry, idx) => (
                    <span key={`B-${entry.attendeeKey || entry.user_id || entry.firstName}-${idx}`}>
                      <button
                        type="button"
                        className="checkin-player-btn"
                        onClick={() => openScoringPrompt('B', entry)}
                      >
                        {entry.shortName || entry.firstName}
                      </button>
                      <button
                        type="button"
                        className="checkin-player-remove"
                        onClick={() => removePlayerFromTeam(entry)}
                        title={`Remover ${entry.shortName || entry.firstName}`}
                        aria-label={`Remover ${entry.shortName || entry.firstName}`}
                      >
                        ❌
                      </button>
                      {idx < teamEntryRows.B.length - 1 ? ' / ' : ''}
                    </span>
                  ))
                ) : (
                  teamEntries.B.join(' / ')
                )
              ) : 'Sem check-in registrado.'}
            </div>
            {canEdit && (teamEntryRows.B || []).length ? (
              <button
                type="button"
                className="team-clear-btn"
                onClick={() => removeAllPlayersFromTeam('B')}
                title={`Remover todos de ${viewTeamB}`}
                aria-label={`Remover todos de ${viewTeamB}`}
              >
                remover todos
              </button>
            ) : null}
          </div>
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
                    {`${idx + 1}. ${s.name}: ${s.totalPoints} pontos 🏀\t(${fmtBasketCount(s.one)}) 1 ponto`}
                  </span>
                  {s.name !== 'Outros' ? (
                    <button className="basket-del-btn" onClick={() => removeBasketByPlayerAndType(s.name, 1)}>❌</button>
                  ) : null}
                  <span className="basket-tabbed-line">
                    {`\t(${fmtBasketCount(s.two)}) 2 pontos`}
                  </span>
                  {s.name !== 'Outros' ? (
                    <button className="basket-del-btn" onClick={() => removeBasketByPlayerAndType(s.name, 2)}>❌</button>
                  ) : null}
                  <span className="basket-tabbed-line">
                    {`\t(${fmtBasketCount(s.three)}) 3 pontos`}
                  </span>
                  {s.name !== 'Outros' ? (
                    <button className="basket-del-btn" onClick={() => removeBasketByPlayerAndType(s.name, 3)}>❌</button>
                  ) : null}
                </>
              ) : (
                <>
                  <strong>{idx + 1}. {s.name}: {s.totalPoints} pontos</strong>
                  {' '}🏀{' '}| ({fmtBasketCount(s.one)}) 1 ponto | ({fmtBasketCount(s.two)}) 2 pontos | ({fmtBasketCount(s.three)}) 3 pontos
                </>
              )}
            </div>
          ))
        )}
      </details>

      <div className="panel attendance-panel">
        <div className="attendance-header-row">
          <div className="label">Presentes no dia</div>
          {canEdit ? (
            <div className="attendance-target">
              Adicionando em: <strong>{assignmentSide === 'A' ? viewTeamA : assignmentSide === 'B' ? viewTeamB : 'nenhum time'}</strong>
            </div>
          ) : null}
        </div>
        {availableAttendanceList.length ? (
          <div className="attendance-list">
            {availableAttendanceList.map((person) => (
              <button
                key={person.id || person.attendee_key || person.user_id || person.player_name}
                type="button"
                className={`attendance-pill ${canEdit ? 'interactive' : ''}`}
                onClick={() => {
                  if (!canEdit) return;
                  if (!assignmentSide) {
                    showAlert('Selecione primeiro o Time 1 ou o Time 2.');
                    return;
                  }
                  assignAttendanceToTeam(person, assignmentSide);
                }}
              >
                {formatAttendanceName(person.player_name)}
              </button>
            ))}
          </div>
        ) : attendanceList.length ? (
          <div className="muted">Todos os presentes já foram atribuídos a um time.</div>
        ) : (
          <div className="muted">Nenhuma presença registrada hoje.</div>
        )}
      </div>

      <PasswordModal
        open={passwordState.open}
        title="Senha"
        message={passwordState.message}
        onClose={closePasswordModal}
        onConfirm={confirmPassword}
      />

      {scoringPrompt.open ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal modal-small">
            <div className="modal-title">{scoringPrompt.entry?.shortName || scoringPrompt.entry?.player_name} marcou quantos pontos?</div>
            <div className="actions">
              <button className="btn-controle" onClick={() => handleScoreChoice(1)}>+1</button>
              <button className="btn-controle" onClick={() => handleScoreChoice(2)}>+2</button>
              <button className="btn-controle" onClick={() => handleScoreChoice(3)}>+3</button>
              <button className="btn-outline" onClick={() => setScoringPrompt({ open: false, team: null, entry: null })}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : null}

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
