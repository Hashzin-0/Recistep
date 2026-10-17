"use client";

import { useAuth } from "@/components/auth-provider";

export function SignInPrompt({ message = "Entre para salvar e organizar suas receitas." }: { message?: string }) {
  const { signedInEmail, isAuthBusy, signIn, authFeedback } = useAuth();
  if (signedInEmail) return null;

  return (
    <div className="sign-in-prompt">
      <p>{message}</p>
      <button className="auth-google-button" type="button" onClick={() => void signIn()} disabled={isAuthBusy}>
        <svg aria-hidden="true" viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 3.01 13.22l7.98 6.19C12.88 13.72 18.01 9.5 24 9.5Z" transform="translate(0 4)"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.42 38.06 46.98 31.92 46.98 24.55Z"/>
          <path fill="#FBBC05" d="M10.99 28.59A14.4 14.4 0 0 1 10.2 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 .0 24c0 3.86.92 7.5 2.56 10.78l8.43-6.19Z" transform="translate(0 4)"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.17 2.3-5.99 0-11.12-4.22-13.01-9.91l-8.43 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(0 -4)"/>
        </svg>
        {isAuthBusy ? "Conectando…" : "Continuar com Google"}
      </button>
      <p className="auth-google-hint">Autenticação segura pelo Supabase Auth.</p>
      {authFeedback && <p className="auth-feedback" role="status" aria-live="polite">{authFeedback}</p>}
    </div>
  );
}
