import type { SessionClaims } from '@scm/shared';
import { create } from 'zustand';

interface SessionState {
  accessToken: string | undefined;
  claims: SessionClaims | undefined;
  clear: () => void;
  establish: (accessToken: string, claims: SessionClaims) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  accessToken: undefined,
  claims: undefined,
  clear: () => set({ accessToken: undefined, claims: undefined }),
  establish: (accessToken, claims) => set({ accessToken, claims }),
}));
