import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [authDebug, setAuthDebug] = useState({ stage: 'init', error: '', lookup: '' });

  async function loadProfile(userId, userEmail) {
    if (!userId) {
      setProfile(null);
      setAuthDebug({ stage: 'no-user', error: '', lookup: '' });
      return null;
    }

    const normalizedEmail = String(userEmail || '').trim().toLowerCase();
    setAuthDebug({ stage: 'loading-profile', error: '', lookup: `id:${userId}` });

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
      setAuthDebug({ stage: 'loading-profile-fallback-email', error: error?.message || '', lookup: `email:${normalizedEmail}` });
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
      setAuthDebug({ stage: 'profile-error', error: error.message || String(error), lookup: normalizedEmail ? `email:${normalizedEmail}` : `id:${userId}` });
      return null;
    }
    if (!data) {
      setProfile(null);
      setAuthDebug({ stage: 'profile-not-found', error: '', lookup: normalizedEmail ? `email:${normalizedEmail}` : `id:${userId}` });
      return null;
    }
    setProfile(data);
    setAuthDebug({ stage: 'profile-loaded', error: '', lookup: data.email || normalizedEmail || `id:${userId}` });
    return data;
  }

  useEffect(() => {
    let mounted = true;

    async function syncSession(newSession) {
      if (!mounted) return;
      setLoading(true);
      try {
        setSession(newSession || null);
        await loadProfile(newSession?.user?.id, newSession?.user?.email);
      } catch (error) {
        console.warn('Auth sync error', error?.message || error);
        if (mounted) {
          setProfile(null);
          setAuthDebug({ stage: 'sync-error', error: error?.message || String(error), lookup: '' });
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
          setAuthDebug({ stage: 'get-session-error', error: error?.message || String(error), lookup: '' });
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
    }
  }, [profile?.is_active]);

  const value = useMemo(() => ({
    session,
    loading,
    user: session?.user || null,
    profile,
    role: profile?.role || 'observer',
    isMaster: profile?.role === 'master' && profile?.is_active !== false,
    isScoreboard: profile?.role === 'scoreboard' && profile?.is_active !== false,
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
  }), [session, loading, profile, authDebug]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
