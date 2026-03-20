import { useLocation, Link } from "wouter";
import { LayoutDashboard, Building2, Plus, Chrome, BarChart3, Bookmark, LogOut, User, Wallet, CreditCard } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const navItems = [
  { title: "Pipeline", url: "/", icon: LayoutDashboard },
  { title: "Companies", url: "/companies", icon: Building2 },
  { title: "Add Deal", url: "/add", icon: Plus },
  { title: "Wallet", url: "/wallet", icon: Wallet },
  { title: "Billing", url: "/credits", icon: CreditCard },
  { title: "Extension", url: "/extension", icon: Chrome },
  { title: "Data", url: "/data", icon: BarChart3 },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout, isLoggingOut } = useAuth();

  const displayName = user?.email || user?.username || "User";
  const walletShort = user?.walletAddress
    ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`
    : null;

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Bookmark className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight" data-testid="text-app-title">BookMark</h1>
              <p className="text-xs text-muted-foreground">Deal Intelligence</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    data-active={location === item.url}
                    className="data-[active=true]:bg-sidebar-accent"
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(' ', '-')}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3 space-y-2">
        {user && (
          <>
            {walletShort && (
              <Link href="/wallet">
                <div className="flex items-center justify-between px-3 py-2 rounded-md bg-accent/50 cursor-pointer hover:bg-accent transition-colors" data-testid="link-wallet">
                  <span className="text-xs font-medium text-muted-foreground">Wallet</span>
                  <span className="text-xs font-mono tabular-nums" data-testid="text-wallet">{walletShort}</span>
                </div>
              </Link>
            )}
            <div className="flex items-center justify-between gap-2 px-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <span className="text-sm font-medium truncate" data-testid="text-username">{displayName}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => logout()}
                disabled={isLoggingOut}
                data-testid="button-logout"
              >
                <LogOut className="w-3.5 h-3.5" />
              </Button>
            </div>
          </>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
