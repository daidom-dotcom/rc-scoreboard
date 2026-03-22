export function compactFullName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
}

export function emailLocalName(email) {
  const local = String(email || '').trim().split('@')[0] || '';
  if (!local) return '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (!parts.length) return local;
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  if (parts.length === 1) return first;
  return `${first} ${parts[1].charAt(0).toUpperCase()}.`;
}

export function preferredDisplayName(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const raw = String(value).trim();
    return raw.includes('@') ? emailLocalName(raw) : compactFullName(raw);
  }
  const nickname = String(value.nickname || '').trim();
  if (nickname) return nickname;
  const fullName = String(value.full_name || value.player_name || '').trim();
  if (fullName) return compactFullName(fullName);
  return emailLocalName(value.email || '');
}

export function preferredShortGreeting(value) {
  if (!value) return '';
  if (typeof value === 'string') return String(value).trim().split(/\s+/)[0] || '';
  const nickname = String(value.nickname || '').trim();
  if (nickname) return nickname;
  const fullName = String(value.full_name || '').trim();
  if (fullName) return fullName.split(/\s+/)[0] || '';
  const local = String(value.email || '').trim().split('@')[0] || '';
  return local || '';
}
