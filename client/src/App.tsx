import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { setAccessTokenGetter } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

import { useAuth } from "@/hooks/use-auth";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useEffect } from "react";
import NotFound from "@/pages/not-found";
import Pipeline from "@/pages/pipeline";
import Companies from "@/pages/companies";
import CompanyDetail from "@/pages/company-detail";
import AddDeal from "@/pages/add-deal";
import ExtensionPage from "@/pages/extension";
import DataPage from "@/pages/data";
import CreditsPage from "@/pages/credits";
import WalletPage from "@/pages/wallet";
import ReportViewer from "@/pages/report-viewer";
import LandingPage from "@/pages/landing-page";
import AuthPage from "@/pages/auth-page";
import { QuickCapture } from "@/components/quick-capture";
import { Loader2 } from "lucide-react";

const tempoChain = {
  id: 4217,
  name: "Tempo Mainnet",
  network: "tempo",
  nativeCurrency: {
    name: "USD",
    symbol: "USD",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.mainnet.tempo.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "Tempo Explorer",
      url: "https://explore.mainnet.tempo.xyz",
    },
  },
};

function AccessTokenSync() {
  const { getAccessToken } = usePrivy();
  useEffect(() => {
    setAccessTokenGetter(getAccessToken);
  }, [getAccessToken]);
  return null;
}

function AppRouter() {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/auth" component={AuthPage} />
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    );
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center gap-1 p-2 border-b border-border/50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
          <main className="flex-1 overflow-hidden">
            <Switch>
              <Route path="/" component={Pipeline} />
              <Route path="/companies" component={Companies} />
              <Route path="/companies/:id" component={CompanyDetail} />
              <Route path="/reports/:id" component={ReportViewer} />
              <Route path="/add" component={AddDeal} />
              <Route path="/extension" component={ExtensionPage} />
              <Route path="/credits" component={CreditsPage} />
              <Route path="/wallet" component={WalletPage} />
              <Route path="/data" component={DataPage} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>
      <QuickCapture />
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID || ""}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#000000",
          logo: undefined,
        },
        loginMethods: ["email", "wallet"],
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
        },
        defaultChain: tempoChain as any,
        supportedChains: [tempoChain as any],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AccessTokenSync />
          <AppRouter />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
