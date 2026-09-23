"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "sent" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "sending" });

    const supabase = createClient();
    const trimmedEmail = email.trim().toLowerCase();

    // 매직링크 발송. 유저가 처음이면 auth.users에 자동 생성되고,
    // Supabase 트리거 on_auth_user_created 가 reviewers 테이블에도 자동 등록.
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback`,
      },
    });

    if (error) {
      setStatus({ kind: "error", message: `발송 실패: ${error.message}` });
    } else {
      setStatus({ kind: "sent" });
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold mb-2">GT Review Labeler</h1>
        <p className="text-gray-600 mb-6 text-sm">
          이메일 주소로 로그인 링크를 보내드립니다.
        </p>

        {status.kind === "sent" ? (
          <div className="bg-green-50 border border-green-200 rounded p-4 text-sm text-green-800">
            <p className="font-semibold mb-1">이메일을 확인하세요</p>
            <p>
              <strong>{email}</strong> 로 로그인 링크를 보냈습니다. 링크를
              클릭하면 자동으로 로그인됩니다.
            </p>
            <p className="mt-2 text-xs text-green-700">
              메일이 안 보이면 스팸함도 확인해보세요.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                이메일
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status.kind === "sending"}
                placeholder="you@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {status.kind === "error" && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
                {status.message}
              </div>
            )}

            <button
              type="submit"
              disabled={status.kind === "sending"}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition"
            >
              {status.kind === "sending" ? "발송 중..." : "로그인 링크 받기"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
