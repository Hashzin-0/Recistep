"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { startGoogleOAuth } from "@/lib/supabase/google-oauth";

type AuthContextValue = {
  supabase: SupabaseClient | null;
  accessToken: string | null;
  signedInEmail: string | null;
  isAuthBusy: boolean;
  authFeedback: string | null;
  setAuthFeedback: (message: string | null) => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (supabaseRef.current === null) supabaseRef.current = createBrowserSupabaseClient();
  const supabase = supabaseRef.current;

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [authFeedback, setAuthFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setAuthFeedback("Autenticação indisponível: configure as variáveis públicas do Supabase.");
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setAccessToken(data.session?.access_token ?? null);
      setSignedInEmail(data.session?.user.email ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token ?? null);
      setSignedInEmail(session?.user.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, [supabase]);

  const signIn = useCallback(async () => {
    if (!supabase) {
      setAuthFeedback("Configure o Supabase para habilitar autenticação.");
      return;
    }
    setIsAuthBusy(true);
    setAuthFeedback(null);
    try {
      const { data, error } = await startGoogleOAuth(supabase, window.location.origin);
      if (error || !data.url) {
        setAuthFeedback(
          error
            ? "O Supabase recusou o login. Confira se o provedor Google está habilitado e se a URL de retorno está autorizada."
            : "O Supabase não retornou a URL de autenticação. Confira a configuração do provedor Google.",
        );
        setIsAuthBusy(false);
        return;
      }
      setAuthFeedback("Abrindo a autenticação do Google…");
      window.location.assign(data.url);
    } catch {
      setAuthFeedback("Não foi possível conectar ao serviço de autenticação.");
      setIsAuthBusy(false);
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    setIsAuthBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      setAuthFeedback(error ? "Não foi possível encerrar a sessão agora." : "Sessão encerrada.");
    } catch {
      setAuthFeedback("Não foi possível conectar ao serviço de autenticação.");
    } finally {
      setIsAuthBusy(false);
    }
  }, [supabase]);

  const value: AuthContextValue = {
    supabase,
    accessToken,
    signedInEmail,
    isAuthBusy,
    authFeedback,
    setAuthFeedback,
    signIn,
    signOut,
    getAccessToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de AuthProvider.");
  return context;
}
