import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function formatDateBR(iso: string) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '-';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function escapeHtml(s: string) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const matchId = String(body?.matchId || '').trim();
    if (!matchId) {
      return new Response(JSON.stringify({ error: 'matchId obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const resendKey = Deno.env.get('RESEND_API_KEY') || '';
    const toEmail = Deno.env.get('MATCH_SUMMARY_TO_EMAIL') || '';
    const fromEmail = Deno.env.get('MATCH_SUMMARY_FROM_EMAIL') || 'Rachao <onboarding@resend.dev>';

    if (!supabaseUrl || !serviceRole || !anonKey) {
      return new Response(JSON.stringify({ error: 'Credenciais Supabase ausentes' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (!resendKey || !toEmail) {
      return new Response(JSON.stringify({ error: 'Config de email ausente (RESEND_API_KEY / MATCH_SUMMARY_TO_EMAIL)' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRole);
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: req.headers.get('Authorization') || '' }
      }
    });

    const { data: authData, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !authData?.user?.id) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (profileErr) {
      return new Response(JSON.stringify({ error: profileErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const role = String(profile?.role || '');
    if (role !== 'master' && role !== 'scoreboard') {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: match, error: matchErr } = await supabaseAdmin
      .from('matches')
      .select('id,date_iso,match_no,team_a_name,team_b_name,mode')
      .eq('id', matchId)
      .maybeSingle();
    if (matchErr || !match) {
      return new Response(JSON.stringify({ error: matchErr?.message || 'Partida não encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: result, error: resultErr } = await supabaseAdmin
      .from('match_results')
      .select('score_a,score_b')
      .eq('match_id', matchId)
      .maybeSingle();
    if (resultErr || !result) {
      return new Response(JSON.stringify({ error: resultErr?.message || 'Resultado não encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: events, error: eventsErr } = await supabaseAdmin
      .from('basket_events')
      .select('player_name,points')
      .eq('match_id', matchId);
    if (eventsErr) {
      return new Response(JSON.stringify({ error: eventsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const pointsByPlayer = new Map<string, number>();
    (events || []).forEach((e) => {
      const player = String(e.player_name || '').trim() || 'Outros';
      const pts = Number(e.points || 0);
      pointsByPlayer.set(player, (pointsByPlayer.get(player) || 0) + pts);
    });

    const ranking = Array.from(pointsByPlayer.entries())
      .map(([name, pts]) => ({ name, pts }))
      .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name, 'pt-BR'));

    const pointsLine = ranking.length
      ? ranking.map((r) => `${r.pts} ${r.name}`).join(', ')
      : 'Sem cestas registradas.';

    const dateBr = formatDateBR(String(match.date_iso || ''));
    const partidaNo = Number(match.match_no || 0) || 1;
    const lineScore = `${match.team_a_name} ${result.score_a} x ${result.score_b} ${match.team_b_name}`;
    const textBody = [
      'Rachão dos Crias',
      dateBr,
      `[Partida ${partidaNo}] Finalizada`,
      `*${lineScore}*`,
      `Pontos: ${pointsLine}.`
    ].join('\n');

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;line-height:1.45">
        <div>Rachão dos Crias</div>
        <div>${escapeHtml(dateBr)}</div>
        <div>[Partida ${partidaNo}] Finalizada</div>
        <div><strong>${escapeHtml(lineScore)}</strong></div>
        <div>Pontos: ${escapeHtml(pointsLine)}.</div>
      </div>
    `;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: `Rachão dos Crias - Partida ${partidaNo} finalizada`,
        text: textBody,
        html: htmlBody
      })
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      return new Response(JSON.stringify({ error: `Falha no envio de email: ${errText}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Erro interno' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

