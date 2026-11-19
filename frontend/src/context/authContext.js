import { createContext } from 'react';

// Shape: { status, user, isAuthenticated, isAdmin, hasRole, setSession, clearSession }
export const AuthContext = createContext(null);
