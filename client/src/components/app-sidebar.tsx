import { useLocation, Link } from "wouter";
import { LayoutDashboard, Building2, Chrome, BarChart3, LogOut, User, Wallet, Activity, FlaskConical, Brain, Network } from "lucide-react";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const navItems = [
  { title: "Pipeline", url: "/", icon: LayoutDashboard },
  { title: "Map", url: "/map", icon: Network },
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
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const displayName = user?.email || user?.username || "User";
  const isAdmin = !!(user && (ADMIN_EMAILS.includes(user.email || "") || ADMIN_USERNAMES.includes(user.username || "")));
  const walletShort = user?.walletAddress
    ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`
    : null;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={collapsed ? "p-2 pb-2" : "p-4 pb-6"}>
        <Link href="/">
          <div className={`flex items-center cursor-pointer group ${collapsed ? "justify-center" : "gap-2.5"}`} data-testid="link-sidebar-home">
            <SessionsMark size={collapsed ? 16 : 18} />
            {!collapsed && (
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
            )}
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {!collapsed && (
            <div className="px-3 pt-1 pb-2 flex items-center gap-2">
              <span className="text-[9px] uppercase tracking-[0.32em] text-muted-foreground/45">
                Navigate
              </span>
              <span className="flex-1 h-px bg-border/40" />
            </div>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map((item, i) => {
                const active = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      data-active={active}
                      className="group relative h-8 rounded-md text-muted-foreground/75 hover:text-foreground hover:bg-sidebar-accent/40 data-[active=true]:bg-sidebar-accent/60 data-[active=true]:text-foreground transition-all"
                    >
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(' ', '-')}`}>
                        {!collapsed && (
                          <span
                            className={`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full transition-all ${
                              active
                                ? "bg-cyan-400/80 shadow-[0_0_8px_rgba(125,207,255,0.6)]"
                                : "bg-transparent group-hover:bg-cyan-400/20"
                            }`}
                          />
                        )}
                        <item.icon
                          className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                            active ? "text-cyan-400/90" : "text-muted-foreground/60 group-hover:text-foreground/80"
                          }`}
                        />
                        {!collapsed && (
                          <>
                            <span className="text-[13px] tracking-tight">{item.title}</span>
                            <span className="ml-auto text-[9px] tabular-nums font-mono text-muted-foreground/30">
                              0{i + 1}
                            </span>
                          </>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {isAdmin && (
                <>
                  {!collapsed && (
                    <div className="px-3 pt-4 pb-2 flex items-center gap-2">
                      <span className="text-[9px] uppercase tracking-[0.32em] text-muted-foreground/45">
                        Admin
                      </span>
                      <span className="flex-1 h-px bg-border/40" />
                    </div>
                  )}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      tooltip="Status"
                      data-active={location === "/admin"}
                      className="group relative h-8 rounded-md text-muted-foreground/75 hover:text-foreground hover:bg-sidebar-accent/40 data-[active=true]:bg-sidebar-accent/60 data-[active=true]:text-foreground transition-all"
                    >
                      <Link href="/admin" data-testid="link-nav-admin">
                        {!collapsed && (
                          <span
                            className={`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full transition-all ${
                              location === "/admin"
                                ? "bg-fuchsia-400/80 shadow-[0_0_8px_rgba(187,154,247,0.6)]"
                                : "bg-transparent group-hover:bg-fuchsia-400/20"
                            }`}
                          />
                        )}
                        <Activity
                          className={`w-3.5 h-3.5 shrink-0 ${
                            location === "/admin" ? "text-fuchsia-400/90" : "text-muted-foreground/60 group-hover:text-foreground/80"
                          }`}
                        />
                        {!collapsed && <span className="text-[13px] tracking-tight">Status</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className={collapsed ? "p-1 space-y-1" : "p-3 space-y-2"}>
        {user && (
          <>
            {walletShort && !collapsed && (
              <Link href="/wallet">
                <div className="flex items-center justify-between px-3 py-2 rounded-md border border-border/50 cursor-pointer hover:bg-accent/50 transition-colors" data-testid="link-wallet">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Wallet</span>
                  <span className="text-xs font-mono tabular-nums text-muted-foreground" data-testid="text-wallet">{walletShort}</span>
                </div>
              </Link>
            )}
            {collapsed ? (
              <div className="flex flex-col items-center gap-1">
                <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center">
                  <User className="w-3 h-3 text-muted-foreground" />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => logout()}
                  disabled={isLoggingOut}
                  data-testid="button-logout"
                  aria-label="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
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
            )}
          </>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
