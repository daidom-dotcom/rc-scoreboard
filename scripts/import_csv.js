import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Uso: node scripts/import_csv.js caminho/para/historico.csv');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_KEY no ambiente.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function parseCsv(content) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value.trim());
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (value.length || row.length) {
        row.push(value.trim());
        rows.push(row);
        row = [];
        value = '';
      }
      continue;
    }

    value += char;
  }

  if (value.length || row.length) {
    row.push(value.trim());
    rows.push(row);
  }

  return rows;
}

function normalizeMode(tipo) {
  const lower = String(tipo || '').toLowerCase();
  if (lower.includes('quick') || lower.includes('rápida') || lower.includes('rapida')) return 'quick';
  return 'tournament';
}

(async () => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(raw);
  const headers = rows.shift();

  const idx = (name) => headers.findIndex((h) => String(h).trim() === name);
  const idxTime1 = headers.findIndex((h, i) => String(h).trim() === 'Time 1' && i > 0);
  const idxTime2 = headers.findIndex((h, i) => String(h).trim() === 'Time 2' && i > 0);

  const iData = idx('Data');
  const iTipo = idx('Tipo de Partida');
  const iT1 = idxTime1 !== -1 ? idxTime1 : idx('Time 1');
  const iT2 = idxTime2 !== -1 ? idxTime2 : idx('Time 2');
  const iS1 = headers.lastIndexOf('Time 1');
  const iS2 = headers.lastIndexOf('Time 2');
  const iC1 = idx('Cestas (1)');
  const iC2 = idx('Cestas (2)');
  const iC3 = idx('Cestas (3)');

  const { data: teams } = await supabase.from('teams').select('*');
  const teamMap = new Map((teams || []).map((t) => [t.name.toLowerCase(), t]));

  const dedupeSet = new Set();
  let created = 0;

  for (const r of rows) {
    const dateISO = String(r[iData] || '').trim();
    if (!dateISO) continue;

    const teamAName = String(r[iT1] || '').trim();
    const teamBName = String(r[iT2] || '').trim();
    if (!teamAName || !teamBName) continue;

    const scoreA = Number(r[iS1] || 0);
    const scoreB = Number(r[iS2] || 0);
    const c1 = Number(r[iC1] || 0);
    const c2 = Number(r[iC2] || 0);
    const c3 = Number(r[iC3] || 0);

    const dedupeKey = `${dateISO}|${teamAName}|${teamBName}|${scoreA}|${scoreB}|${c1}|${c2}|${c3}`;
    if (dedupeSet.has(dedupeKey)) continue;
    dedupeSet.add(dedupeKey);

    let teamA = teamMap.get(teamAName.toLowerCase());
    if (!teamA) {
      const { data: t } = await supabase.from('teams').insert({ name: teamAName }).select().single();
      teamA = t;
      teamMap.set(teamAName.toLowerCase(), t);
    }

    let teamB = teamMap.get(teamBName.toLowerCase());
    if (!teamB) {
      const { data: t } = await supabase.from('teams').insert({ name: teamBName }).select().single();
      teamB = t;
      teamMap.set(teamBName.toLowerCase(), t);
    }

    const mode = normalizeMode(r[iTipo]);
    const matchPayload = {
      date_iso: dateISO,
      mode,
      team_a_id: teamA.id,
      team_b_id: teamB.id,
      team_a_name: teamAName,
      team_b_name: teamBName,
      quarters: mode === 'quick' ? 1 : 4,
      durations: mode === 'quick' ? [420] : [600, 600, 600, 600],
      status: 'done'
    };

    const { data: match, error: matchError } = await supabase.from('matches').insert(matchPayload).select().single();
    if (matchError) {
      console.error('Erro ao inserir match:', matchError.message);
      continue;
    }

    const { error: resError } = await supabase.from('match_results').insert({
      match_id: match.id,
      score_a: scoreA,
      score_b: scoreB,
      baskets1: c1,
      baskets2: c2,
      baskets3: c3,
      finished_at: new Date().toISOString()
    });

    if (resError) {
      console.error('Erro ao inserir resultado:', resError.message);
      continue;
    }

    created++;
  }

  console.log(`Importacao concluida. Partidas criadas: ${created}`);
})();
