import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";

// Client-side MPP wallet initialisation removed 2026-05-19. Browser
// no longer signs on-chain payment proofs — billing is Stripe-only.
// Privy still handles identity + the embedded wallet for users who
// signed up wallet-first; we just don't wire it to a payment channel.

export function useAuth() {
  const { ready, authenticated, login, logout: privyLogout, getAccessToken, user: privyUser } = usePrivy();

  const { data: user, isLoading: userLoading } = useQuery<User | null>({
    queryKey: ["/api/user"],
    queryFn: async () => {
      if (!authenticated) return null;
      const token = await getAccessToken();
      if (!token) return null;
      const res = await fetch("/api/user", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return null;
      // 403 with body.error === "beta_full" means the user authenticated
      // with Privy but the 20-user beta cap was hit. The auth middleware
      // auto-added them to the waitlist. Return a sentinel so the UI can
      // render the "you're on the list" state.
      if (res.status === 403) {
        try {
          const body = await res.json();
          if (body?.error === "beta_full") {
            return { __betaFull: true, ...body } as any;
          }
        } catch {}
        return null;
      }
      if (!res.ok) throw new Error("Failed to fetch user");
      return res.json();
    },
    enabled: ready && authenticated,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const isLoading = !ready || (authenticated && userLoading);

  const handleLogout = async () => {
    await privyLogout();
    queryClient.setQueryData(["/api/user"], null);
    queryClient.clear();
  };

  return {
    user: authenticated ? user : null,
    isLoading,
    isAuthenticated: ready && authenticated && !!user,
    login,
    logout: handleLogout,
    isLoggingOut: false,
    privyUser,
    getAccessToken,
  };
}
