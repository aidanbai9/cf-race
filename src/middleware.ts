import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const AUTH_TIMEOUT_MS = 5000;

/** Refresh Supabase auth sessions on solo/duel/auth routes (@supabase/ssr). */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const controller = new AbortController();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: (input, init) => {
          controller.signal.throwIfAborted();
          return fetch(input, { ...init, signal: controller.signal });
        },
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          if (controller.signal.aborted) return;
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
          Object.entries(headers).forEach(([name, value]) =>
            response.headers.set(name, value)
          );
        },
      },
    }
  );

  const timeoutError = new Error("Middleware auth timed out");
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, AUTH_TIMEOUT_MS);
  });

  try {
    // getClaims skips JWKS for guests and shares its key cache across clients.
    // The overall deadline also bounds SDK refresh retries and response bodies.
    await Promise.race([supabase.auth.getClaims(), deadline]);
    return response;
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    console.warn(timeoutError.message);
    const unavailable = NextResponse.json(
      { error: "Authentication is temporarily unavailable. Please retry." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "5" },
      }
    );
    response.cookies.getAll().forEach((cookie) => unavailable.cookies.set(cookie));
    return unavailable;
  } finally {
    clearTimeout(timer!);
  }
}

export const config = {
  matcher: [
    "/",
    "/problems/:path*",
    "/problems",
    "/sessions",
    "/replay/:path*",
    "/duels",
    "/events",
    "/solo/:path*",
    "/solo",
    "/duel/:path*",
    "/duel",
    "/auth/:path*",
    "/api/solo/:path*",
    "/api/duel/:path*",
    "/api/shares",
    "/api/events",
    "/tournaments",
    "/t/:path*",
    "/api/tournament/:path*",
  ],
};
