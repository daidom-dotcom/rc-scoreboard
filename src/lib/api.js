import { supabase } from './supabase';

export async function fetchTeams() {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createTeam(name) {
  const { data, error } = await supabase
    .from('teams')
    .insert({ name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTeam(id) {
  const { error } = await supabase
    .from('teams')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function fetchMatchesByDate(dateISO) {
  const { data, error } = await supabase
    .from('matches')
    .select(`*, match_results(*)`)
    .eq('date_iso', dateISO)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data || []).map((m) => ({
    ...m,
    match_results: m.match_results && !Array.isArray(m.match_results) ? [m.match_results] : (m.match_results || [])
  }));
  const missing = rows.filter((m) => !m.match_results || m.match_results.length === 0).map((m) => m.id);
  if (missing.length) {
    const { data: results } = await supabase
      .from('match_results')
      .select('*')
      .in('match_id', missing);
    const map = new Map((results || []).map((r) => [r.match_id, r]));
    return rows.map((m) => ({
      ...m,
      match_results: m.match_results?.length ? m.match_results : (map.get(m.id) ? [map.get(m.id)] : [])
    }));
  }
  return rows;
}

export async function fetchMatchesByRange({ dateFrom, dateTo, mode, team }) {
  let query = supabase
    .from('matches')
    .select(`*, match_results(*)`)
    .gte('date_iso', dateFrom)
    .lte('date_iso', dateTo)
    .order('date_iso', { ascending: false })
    .order('created_at', { ascending: false });

  if (mode && mode !== 'all') query = query.eq('mode', mode);
  if (team && team !== 'all') {
    query = query.or(`team_a_name.ilike.%${team}%,team_b_name.ilike.%${team}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []).map((m) => ({
    ...m,
    match_results: m.match_results && !Array.isArray(m.match_results) ? [m.match_results] : (m.match_results || [])
  }));
  const missing = rows.filter((m) => !m.match_results || m.match_results.length === 0).map((m) => m.id);
  if (missing.length) {
    const { data: results } = await supabase
      .from('match_results')
      .select('*')
      .in('match_id', missing);
    const map = new Map((results || []).map((r) => [r.match_id, r]));
    return rows.map((m) => ({
      ...m,
      match_results: m.match_results?.length ? m.match_results : (map.get(m.id) ? [map.get(m.id)] : [])
    }));
  }
  return rows;
}

export async function createMatch(payload) {
  const { data, error } = await supabase
    .from('matches')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMatch(id, payload) {
  const { data, error } = await supabase
    .from('matches')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMatch(id) {
  const { error } = await supabase
    .from('matches')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function upsertMatchResult(payload) {
  const { data, error } = await supabase
    .from('match_results')
    .upsert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}
