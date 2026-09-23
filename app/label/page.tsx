import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Reviewer, SampleListItem } from "@/lib/types";
import LabelingClient from "./labeling-client";

export const dynamic = "force-dynamic";

export default async function LabelPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 현재 리뷰어 정보
  const { data: reviewer } = await supabase
    .from("reviewers")
    .select("*")
    .eq("email", user.email!)
    .maybeSingle<Reviewer>();

  if (!reviewer) {
    // whitelist에서 지워졌거나 이상 상황 → 로그아웃 후 재로그인 유도
    redirect("/login?error=not_registered");
  }

  // 본인에게 배정된 (또는 admin이면 전부) 샘플 목록의 최소 필드만 가져옴
  const query = supabase
    .from("samples")
    .select(
      "id, row_index, patient_id, review_saved, review_excluded, gt_edited, oph_edited",
    )
    .order("id", { ascending: true });

  if (!reviewer.is_admin) {
    query.eq("assigned_to", reviewer.id);
  }

  const { data: samples, error } = await query;

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold text-red-600 mb-2">
          샘플 목록 로드 실패
        </h1>
        <pre className="bg-red-50 p-4 rounded text-sm">{error.message}</pre>
      </div>
    );
  }

  return (
    <LabelingClient
      reviewer={reviewer}
      initialSamples={(samples ?? []) as SampleListItem[]}
    />
  );
}
