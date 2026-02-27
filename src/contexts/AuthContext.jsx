import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  async function loadProfile(userId) {
    if (!userId) {
      setProfile(null);
      return null;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,role,full_name,is_active')
      .eq('id', userId)
      .single();
    if (error) {
      console.warn('Profile load error', error.message);
      setProfile(null);
      return null;
    }
    setProfile(data || null);
    return data || null;
  }

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      loadProfile(data.session?.user?.id);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      loadProfile(newSession?.user?.id);
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
    signIn: async (email, password) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data?.user) {
        const prof = await loadProfile(data.user.id);
        if (prof?.is_active === false) {
          await supabase.auth.signOut();
          throw new Error('Usuário desativado.');
        }
      }
    },
    signUp: async (email, password, fullName) => {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      if (data?.user?.id && fullName) {
        await supabase
          .from('profiles')
          .update({ full_name: fullName })
          .eq('id', data.user.id);
      }
    },
    signInWithOAuth: async (provider) => {
      const { error } = await supabase.auth.signInWithOAuth({ provider });
      if (error) throw error;
    },
    signOut: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    }
  }), [session, loading, profile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
