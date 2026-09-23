import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Reviewer, ReviewerProgress } from "@/lib/types";
import AdminClient from "./admin-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: reviewer } = await supabase
    .from("reviewers")
    .select("*")
    .eq("email", user.email!)
    .maybeSingle<Reviewer>();

  if (!reviewer?.is_admin) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold">권한 없음</h1>
        <p className="text-gray-600 mt-2">
          관리자 페이지는 admin 계정만 접근할 수 있습니다.
        </p>
        <a href="/label" className="text-blue-600 hover:underline mt-4 inline-block">
          ← 라벨링으로 돌아가기
        </a>
      </div>
    );
  }

  const [{ data: reviewers }, { data: progress }] = await Promise.all([
    supabase
      .from("reviewers")
      .select("*")
      .order("email")
      .returns<Reviewer[]>(),
    supabase
      .from("reviewer_progress")
      .select("*")
      .returns<ReviewerProgress[]>(),
  ]);

  return (
    <AdminClient
      reviewers={reviewers ?? []}
      progress={progress ?? []}
      currentUserEmail={reviewer.email}
    />
  );
}
