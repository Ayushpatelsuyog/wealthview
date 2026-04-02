import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Page routes that don't require auth (and redirect logged-in users away)
  const authPageRoutes = ['/login', '/signup'];
  // API routes that are accessible without auth (no redirect, no 401)
  const publicApiRoutes = ['/api/stocks/search', '/api/stocks/global/search', '/api/stocks/global/price', '/api/fx/rate', '/api/mf/search', '/api/mf/nav', '/api/sif/search'];

  const isAuthPage   = authPageRoutes.some((route) => pathname.startsWith(route));
  const isPublicApi  = publicApiRoutes.some((route) => pathname.startsWith(route));

  if (!user && !isAuthPage && !isPublicApi) {
    // API routes return 401 JSON — don't redirect them to the login page
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login/signup pages only
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
