"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { CrownIcon, HomeIcon, MoonIcon, RefreshCwIcon, SunIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/players", label: "Player", icon: UsersIcon },
  { href: "/leaderboards", label: "排行榜", icon: CrownIcon },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="text-lg font-semibold tracking-tight">SHTechCraft Minigames</Link>
        <nav className="order-3 flex w-full gap-1 sm:order-none sm:w-auto" aria-label="主导航">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Button key={href} render={<Link href={href} />} variant={pathname === href ? "secondary" : "ghost"} className={cn("flex-1 sm:flex-none", pathname === href && "ring-1 ring-foreground/10")}>
              <Icon data-icon="inline-start" />{label}
            </Button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Tooltip><TooltipTrigger render={<Button type="button" variant="outline" size="icon-lg" onClick={() => window.dispatchEvent(new Event("scheduler:refresh"))} />}><RefreshCwIcon /><span className="sr-only">刷新</span></TooltipTrigger><TooltipContent>刷新</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger render={<Button type="button" variant="outline" size="icon-lg" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} />}>{resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}<span className="sr-only">主题</span></TooltipTrigger><TooltipContent>切换主题</TooltipContent></Tooltip>
        </div>
      </div>
    </header>
  );
}
