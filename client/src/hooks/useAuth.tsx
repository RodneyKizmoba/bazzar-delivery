import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, post, queryClient, ApiError } from "@/lib/api";

export interface User {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  phone: string;
  userType: "customer" | "supplier" | "driver" | "admin";
  isApproved: boolean;
  referralCode: string;
  loyaltyPoints: number;
  preferredLanguage: string | null;
  dietaryPreferences: string[];
}

interface AuthCtx {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (u: User | null) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
const KEY = ["/api/auth/me"];

/** Limpa dados de outro utilizador sem desligar a query de sessão que o AuthProvider observa. */
function resetOtherQueries() {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== KEY[0] });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      try {
        return (await get<{ user: User }>("/api/auth/me")).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });

  const setUser = (u: User | null) => {
    if (u?.id !== data?.id) resetOtherQueries();
    queryClient.setQueryData(KEY, u);
  };

  const value: AuthCtx = {
    user: data ?? null,
    isLoading,
    setUser,
    refresh: async () => { await queryClient.invalidateQueries({ queryKey: KEY }); },
    login: async (username, password) => {
      const { user } = await post<{ user: User }>("/api/auth/login", { username, password });
      resetOtherQueries();
      setUser(user);
      return user;
    },
    logout: async () => {
      await post("/api/auth/logout");
      resetOtherQueries();
      setUser(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fora do AuthProvider");
  return c;
}

/** Página inicial de cada tipo de conta. */
export function homeFor(u: User | null): string {
  if (!u) return "/";
  if (u.userType === "supplier") return "/parceiro";
  if (u.userType === "driver") return "/estafeta";
  if (u.userType === "admin") return "/admin";
  return "/";
}
