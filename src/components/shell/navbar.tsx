"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSoloAuth } from "@/components/solo/auth-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogIn, LogOut, Menu, X } from "lucide-react";
import { toast } from "sonner";

// `match` lists every path prefix that should light the link up, so nested
// surfaces (a replay, a duel room) still show where you are in the app.
const LINKS = [
  { href: "/problems", label: "Problems", match: ["/problems"] },
  { href: "/sessions", label: "Sessions", match: ["/sessions", "/replay", "/r"] },
  { href: "/duels", label: "Duels", match: ["/duels", "/duel"] },
  { href: "/events", label: "Events", match: ["/events", "/e"] },
  { href: "/tournaments", label: "Tournaments", match: ["/tournaments", "/t"] },
];

function isActive(pathname: string | null, prefixes: string[]) {
  if (!pathname) return false;
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function AvatarMenu({
  user,
  supabase,
}: Pick<ReturnType<typeof useSoloAuth>, "user" | "supabase"> & {
  user: NonNullable<ReturnType<typeof useSoloAuth>["user"]>;
}) {
  const [open, setOpen] = useState(false);
  const avatar = (user.user_metadata?.avatar_url as string | undefined) ?? null;
  const name =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "You";
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-border/60 p-0.5 hover:border-primary/60"
        aria-label="Account menu"
      >
        {avatar ? (
          <Image
            src={avatar}
            alt={name}
            width={28}
            height={28}
            className="rounded-full"
            unoptimized
          />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 font-mono text-xs uppercase">
            {(name[0] ?? "?").toUpperCase()}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-border/60 bg-popover p-2 shadow-lg">
            <p className="truncate px-2 py-1.5 font-mono text-xs text-muted-foreground">
              {user.email ?? name}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="w-full justify-start"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/";
              }}
            >
              <LogOut className="mr-1.5 h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Persistent app-shell navbar (hidden on booth + in-race screens). */
export function Navbar() {
  const pathname = usePathname();
  const auth = useSoloAuth();
  const { user, supabase, loading } = auth;
  const [mobileOpen, setMobileOpen] = useState(false);

  const signIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(pathname || "/")}`,
      },
    });
    if (error) toast.error(`Google sign-in unavailable: ${error.message}`);
  };

  return (
    <nav className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-6">
        <Link href="/" className="font-mono text-sm font-bold tracking-tight">
          <span className="text-primary">cf</span>racing
        </Link>
        <div className="hidden items-center gap-1 sm:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(pathname, l.match) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                isActive(pathname, l.match) && "bg-accent font-medium text-foreground"
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!loading &&
            (user ? (
              <AvatarMenu user={user} supabase={supabase} />
            ) : (
              <Button size="sm" variant="secondary" onClick={signIn}>
                <LogIn className="mr-1.5 h-3.5 w-3.5" />
                Sign in with Google
              </Button>
            ))}
          <button
            className="sm:hidden"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="border-t border-border/60 px-6 py-2 sm:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMobileOpen(false)}
              aria-current={isActive(pathname, l.match) ? "page" : undefined}
              className={cn(
                "block rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                isActive(pathname, l.match) && "bg-accent font-medium text-foreground"
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
