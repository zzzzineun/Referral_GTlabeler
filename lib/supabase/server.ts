import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: CookieOptions;
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component에서 setAll을 호출하면 에러가 나는 경우가 있음.
            // 미들웨어가 세션 갱신을 처리하므로 무시해도 안전.
          }
        },
      },
    },
  );
}

/**
 * Service Role 키를 쓰는 admin 클라이언트.
 * 절대로 클라이언트에서 쓰지 말고, API 라우트 안에서만 사용.
 */
export function createAdminClient() {
  const { createClient: createSupabase } = require("@supabase/supabase-js");
  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
