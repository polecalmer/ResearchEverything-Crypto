import { useLocation, Link } from "wouter";
import { LayoutDashboard, Building2, Chrome, BarChart3, LogOut, User, Wallet, Activity, FlaskConical, Brain } from "lucide-react";
import { SessionsMark } from "@/components/sessions-mark";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const navItems = [
  { title: "Pipeline", url: "/", icon: LayoutDashboard },
  { title: "Companies", url: "/companies", icon: Building2 },
  { title: "Research", url: "/research", icon: FlaskConical },
  { title: "Brain", url: "/brain", icon: Brain },
  { title: "Wallet", url: "/wallet", icon: Wallet },
  { title: "Extension", url: "/extension", icon: Chrome },
  { title: "Data", url: "/data", icon: BarChart3 },
];

const ADMIN_EMAILS = ["allmysubscriptions10@proton.me"];
const ADMIN_USERNAMES = ["polecalmer"];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout, isLoggingOut } = useAuth();

  const displayName = user?.email || user?.username || "User";
  const isAdmin = !!(user && (ADMIN_EMAILS.includes(user.email || "") || ADMIN_USERNAMES.includes(user.username || "")));
  const walletShort = user?.walletAddress
    ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`
    : null;

  return (
    <Sidebar>
      <SidebarHeader className="p-4 pb-6">
        <Link href="/">
          <div className="flex items-center gap-2.5 cursor-pointer group" data-testid="link-sidebar-home">
            <SessionsMark size={18} />
            <div className="flex flex-col leading-none">
              <span
                className="text-sm font-semibold tracking-tight bg-gradient-to-b from-foreground to-foreground/65 bg-clip-text text-transparent"
                data-testid="text-app-title"
              >
                Sessions
              </span>
              <span className="text-[8.5px] uppercase tracking-[0.32em] text-muted-foreground/55 mt-1">
                perspective layer
              </span>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    data-active={location === item.url}
                    className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-foreground text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(' ', '-')}`}>
                      <item.icon className="w-4 h-4" />
                      <span className="text-sm">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    data-active={location === "/admin"}
                    className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-foreground text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Link href="/admin" data-testid="link-nav-admin">
                      <Activity className="w-4 h-4" />
                      <span className="text-sm">Status</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3 space-y-2">
        {user && (
          <>
            {walletShort && (
              <Link href="/wallet">
                <div className="flex items-center justify-between px-3 py-2 rounded-md border border-border/50 cursor-pointer hover:bg-accent/50 transition-colors" data-testid="link-wallet">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Wallet</span>
                  <span className="text-xs font-mono tabular-nums text-muted-foreground" data-testid="text-wallet">{walletShort}</span>
                </div>
              </Link>
            )}
            <div className="flex items-center justify-between gap-2 px-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center shrink-0">
                  <User className="w-3 h-3 text-muted-foreground" />
                </div>
                <span className="text-xs text-muted-foreground truncate" data-testid="text-username">{displayName}</span>
              </div>
              <div className="flex items-center gap-0.5">
                <ThemeToggle />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => logout()}
                  disabled={isLoggingOut}
                  data-testid="button-logout"
                  aria-label="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
