import { supabase } from './supabase';

export async function createTournament(payload) {
  const { data, error } = await supabase
    .from('tournaments')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTournament(id, payload) {
  const { data, error } = await supabase
    .from('tournaments')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchTournament(id) {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function fetchMatchesByTournament(tournamentId) {
  const { data, error } = await supabase
    .from('matches')
    .select(`*, match_results(*)`)
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data || []).map((m) => ({
    ...m,
    match_results: m.match_results && !Array.isArray(m.match_results) ? [m.match_results] : (m.match_results || [])
  }));
  return rows;
}
