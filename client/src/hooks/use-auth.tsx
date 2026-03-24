import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryClient } from "@/lib/queryClient";
import { initMppx, resetMppx } from "@/lib/mpp";
import type { User } from "@shared/schema";

export function useAuth() {
  const { ready, authenticated, login, logout: privyLogout, getAccessToken, user: privyUser } = usePrivy();
  const { wallets } = useWallets();

  useEffect(() => {
    if (!authenticated || wallets.length === 0) return;

    const wallet = wallets.find((w) => w.walletClientType === "privy")
      || wallets[0];
    if (!wallet) return;

    wallet.getEthereumProvider().then((provider) => {
      initMppx(provider).catch(console.error);
    });
  }, [authenticated, wallets]);

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
      if (!res.ok) throw new Error("Failed to fetch user");
      return res.json();
    },
    enabled: ready && authenticated,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const isLoading = !ready || (authenticated && userLoading);

  const handleLogout = async () => {
    resetMppx();
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
