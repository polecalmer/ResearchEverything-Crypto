import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import Pipeline from "@/pages/pipeline";
import Companies from "@/pages/companies";
import CompanyDetail from "@/pages/company-detail";
import AddDeal from "@/pages/add-deal";
import ExtensionPage from "@/pages/extension";
import DataPage from "@/pages/data";
import LandingPage from "@/pages/landing-page";
import { QuickCapture } from "@/components/quick-capture";
import { Loader2 } from "lucide-react";

function AppRouter() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/" component={LandingPage} />
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
          <header className="flex items-center justify-between gap-1 p-2 border-b">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-hidden">
            <Switch>
              <Route path="/" component={Pipeline} />
              <Route path="/companies" component={Companies} />
              <Route path="/companies/:id" component={CompanyDetail} />
              <Route path="/add" component={AddDeal} />
              <Route path="/extension" component={ExtensionPage} />
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
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppRouter />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
