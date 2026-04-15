import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PROFILE_CACHE_KEY = 'rc-scoreboard-profile-cache';
const FORCED_MASTER_EMAILS = new Set(['claudioemerenciano@hotmail.com']);

function isForcedMasterEmail(email) {
  return FORCED_MASTER_EMAILS.has(String(email || '').trim().toLowerCase());
}
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

function readCachedProfile(userId, userEmail) {
  try {
    const raw = window.localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const normalizedEmail = String(userEmail || '').trim().toLowerCase();
    if (parsed.id === userId) return parsed;
    if (normalizedEmail && String(parsed.email || '').trim().toLowerCase() === normalizedEmail) return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile) {
  try {
    if (!profile?.id) return;
    window.localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
  } catch {}
}

function clearCachedProfile() {
  try {
    window.localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {}
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [authDebug, setAuthDebug] = useState({ stage: 'init', error: '', lookup: '', elapsedMs: 0, startedAt: 0 });

  async function loadProfile(userId, userEmail) {
    const startedAt = Date.now();
    const buildDebug = (patch = {}) => ({
      stage: 'init',
      error: '',
      lookup: '',
      startedAt,
      elapsedMs: Date.now() - startedAt,
      ...patch,
    });

    if (!userId) {
      setProfile(null);
      clearCachedProfile();
      setAuthDebug(buildDebug({ stage: 'no-user' }));
      return null;
    }

    const normalizedEmail = String(userEmail || '').trim().toLowerCase();
    setAuthDebug(buildDebug({ stage: 'loading-profile', lookup: `id:${userId}` }));

    async function fetchProfile(column, value) {
      const baseSelect = 'id,email,role,full_name,nickname,is_active,must_reset_password';
      const fallbackSelect = 'id,email,role,full_name,nickname,is_active';
      const applyFilter = (query) => (column === 'email' ? query.ilike(column, String(value || '').trim()) : query.eq(column, value));
      const run = async () => {
        let response = await applyFilter(
          supabase
            .from('profiles')
            .select(baseSelect)
        ).maybeSingle();

        if (response.error && String(response.error.message || '').includes('must_reset_password')) {
          response = await applyFilter(
            supabase
              .from('profiles')
              .select(fallbackSelect)
          ).maybeSingle();
          if (response.data) response.data = { ...response.data, must_reset_password: false };
        }
        return response;
      };

      return await Promise.race([
        run(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout carregando profiles por ${column}`)), 5000))
      ]);
    }

    let data = null;
    let error = null;

    try {
      ({ data, error } = await fetchProfile('id', userId));
    } catch (err) {
      error = err;
    }

    if ((!data || error) && normalizedEmail) {
      setAuthDebug(buildDebug({ stage: 'loading-profile-fallback-email', error: error?.message || '', lookup: `email:${normalizedEmail}` }));
      try {
        const fallback = await fetchProfile('email', normalizedEmail);
        if (fallback?.data) {
          data = fallback.data;
          error = fallback.error || null;
          console.warn('Profile loaded by email fallback for', normalizedEmail);
        } else if (!data) {
          error = fallback?.error || error;
        }
      } catch (err) {
        if (!data) error = err;
      }
    }

    if (error) {
      console.warn('Profile load error', error.message);
      setProfile(null);
      clearCachedProfile();
      setAuthDebug(buildDebug({ stage: 'profile-error', error: error.message || String(error), lookup: normalizedEmail ? `email:${normalizedEmail}` : `id:${userId}` }));
      return null;
    }
    if (!data) {
      setProfile(null);
      clearCachedProfile();
      setAuthDebug(buildDebug({ stage: 'profile-not-found', lookup: normalizedEmail ? `email:${normalizedEmail}` : `id:${userId}` }));
      return null;
    }
    setProfile(data);
    writeCachedProfile(data);
    setAuthDebug(buildDebug({ stage: 'profile-loaded', lookup: data.email || normalizedEmail || `id:${userId}` }));
    return data;
  }

  useEffect(() => {
    let mounted = true;

    async function syncSession(newSession) {
      if (!mounted) return;
      setLoading(true);
      try {
        setSession(newSession || null);

        if (!newSession?.user) {
          setProfile(null);
          clearCachedProfile();
          setAuthDebug({ stage: 'no-session', error: '', lookup: '', elapsedMs: 0, startedAt: 0 });
          return;
        }

        const cached = readCachedProfile(newSession.user.id, newSession.user.email);
        if (cached && mounted) {
          setProfile(cached);
          setAuthDebug({ stage: 'profile-cached', error: '', lookup: cached.email || newSession.user.email || '', elapsedMs: 0, startedAt: Date.now() });
          setLoading(false);
        }

        await loadProfile(newSession?.user?.id, newSession?.user?.email);
      } catch (error) {
        console.warn('Auth sync error', error?.message || error);
        if (mounted) {
          setProfile(null);
          clearCachedProfile();
          setAuthDebug({ stage: 'sync-error', error: error?.message || String(error), lookup: '', elapsedMs: 0, startedAt: 0 });
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    supabase.auth.getSession()
      .then(({ data }) => syncSession(data.session || null))
      .catch((error) => {
        console.warn('Get session error', error?.message || error);
        if (mounted) {
          setSession(null);
          setProfile(null);
          setAuthDebug({ stage: 'get-session-error', error: error?.message || String(error), lookup: '', elapsedMs: 0, startedAt: 0 });
          setLoading(false);
        }
      });

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (event === 'TOKEN_REFRESHED') {
        if (mounted) setSession(newSession || null);
        return;
      }
      await syncSession(newSession);
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (profile?.is_active === false) {
      supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      clearCachedProfile();
    }
  }, [profile?.is_active]);

  const forcedMaster = isForcedMasterEmail(session?.user?.email);

  const value = useMemo(() => ({
    session,
    loading,
    user: session?.user || null,
    profile,
    role: forcedMaster ? 'master' : (profile?.role || 'observer'),
    isMaster: forcedMaster || (profile?.role === 'master' && profile?.is_active !== false),
    isScoreboard: !forcedMaster && profile?.role === 'scoreboard' && profile?.is_active !== false,
    signIn: async (email, password) => {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (error) throw error;
      if (data?.user) {
        const prof = await loadProfile(data.user.id, data.user.email);
        if (prof?.is_active === false) {
          await supabase.auth.signOut();
          throw new Error('Usuário desativado.');
        }
      }
    },
    signUp: async (email, password, fullName, nickname) => {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const { data, error } = await supabase.auth.signUp({ email: normalizedEmail, password });
      if (error) throw error;
      if (data?.user?.id && (fullName || nickname)) {
        await supabase
          .from('profiles')
          .update({ full_name: fullName, nickname })
          .eq('id', data.user.id);
      }
    },
    resetPassword: async (email) => {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/reset-password`
      });
      if (error) throw error;
    },
    signInWithOAuth: async (provider) => {
      const { error } = await supabase.auth.signInWithOAuth({ provider });
      if (error) throw error;
    },
    signOut: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    authDebug
  }), [session, loading, profile, authDebug, forcedMaster]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
