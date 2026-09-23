"use client";

import { useState } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import type { Reviewer, ReviewerProgress } from "@/lib/types";

type Props = {
  reviewers: Reviewer[];
  progress: ReviewerProgress[];
  currentUserEmail: string;
};

const REQUIRED_CSV_COLS = ["oph_record", "gt"];

export default function AdminClient({
  reviewers: initialReviewers,
  progress,
  currentUserEmail,
}: Props) {
  const supabase = createClient();
  const [reviewers, setReviewers] = useState(initialReviewers);
  const [tab, setTab] = useState<"progress" | "reviewers" | "import">(
    "progress",
  );

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">관리자</h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">{currentUserEmail}</span>
            <a href="/label" className="text-blue-600 hover:underline">
              ← 라벨링으로
            </a>
          </div>
        </div>

        <div className="flex gap-1 border-b border-gray-300 mb-4">
          {(["progress", "reviewers", "import"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px ${
                tab === t
                  ? "border-blue-600 text-blue-600 font-semibold"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {t === "progress"
                ? "진행 통계"
                : t === "reviewers"
                  ? "리뷰어 관리"
                  : "CSV 임포트"}
            </button>
          ))}
        </div>

        {tab === "progress" && <ProgressTab progress={progress} />}
        {tab === "reviewers" && (
          <ReviewersTab
            reviewers={reviewers}
            onChange={setReviewers}
            supabase={supabase}
          />
        )}
        {tab === "import" && <ImportTab supabase={supabase} />}
      </div>
    </div>
  );
}

// ==========================================================================
// 진행 통계 탭 (리뷰어별)
// ==========================================================================
function ProgressTab({ progress }: { progress: ReviewerProgress[] }) {
  const totals = progress.reduce(
    (acc, p) => ({
      total: acc.total + Number(p.total_assigned),
      done: acc.done + Number(p.done),
      valid: acc.valid + Number(p.valid),
      excluded: acc.excluded + Number(p.excluded),
    }),
    { total: 0, done: 0, valid: 0, excluded: 0 },
  );

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-3">리뷰어별 진행 상황</h2>
      <div className="mb-4 text-sm text-gray-600">
        전체 (합계): <strong>{totals.total}</strong> · 완료{" "}
        <strong>{totals.done}</strong> · 유효 <strong>{totals.valid}</strong> ·
        제외 <strong>{totals.excluded}</strong>
        <div className="text-xs text-gray-500 mt-1">
          각 리뷰어가 모든 샘플을 독립적으로 라벨링합니다. 리뷰어 N명 × 샘플
          M개 = N×M assignments.
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 px-2">리뷰어</th>
            <th className="text-right py-2 px-2">총 샘플</th>
            <th className="text-right py-2 px-2">완료</th>
            <th className="text-right py-2 px-2">유효</th>
            <th className="text-right py-2 px-2">제외</th>
            <th className="text-right py-2 px-2">GT 수정</th>
            <th className="text-right py-2 px-2">OPH 수정</th>
            <th className="text-right py-2 px-2">진행률</th>
            <th className="text-left py-2 px-2">최근 활동</th>
          </tr>
        </thead>
        <tbody>
          {progress.map((p) => {
            const pct =
              Number(p.total_assigned) > 0
                ? Math.round((Number(p.done) / Number(p.total_assigned)) * 100)
                : 0;
            return (
              <tr key={p.reviewer_id} className="border-b border-gray-100">
                <td className="py-2 px-2">
                  <div>
                    {p.display_name || "—"}
                    {p.is_admin && (
                      <span className="ml-1 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                        admin
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{p.email}</div>
                </td>
                <td className="text-right py-2 px-2">{p.total_assigned}</td>
                <td className="text-right py-2 px-2">{p.done}</td>
                <td className="text-right py-2 px-2 text-green-700">
                  {p.valid}
                </td>
                <td className="text-right py-2 px-2 text-red-700">
                  {p.excluded}
                </td>
                <td className="text-right py-2 px-2">{p.gt_edited_count}</td>
                <td className="text-right py-2 px-2">{p.oph_edited_count}</td>
                <td className="text-right py-2 px-2">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-2 bg-gray-200 rounded overflow-hidden">
                      <div
                        className="h-full bg-blue-600"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span>{pct}%</span>
                  </div>
                </td>
                <td className="py-2 px-2 text-xs text-gray-500">
                  {p.last_activity_at
                    ? new Date(p.last_activity_at).toLocaleString("ko-KR")
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ==========================================================================
// 리뷰어 관리 탭
// ==========================================================================
function ReviewersTab({
  reviewers,
  onChange,
  supabase,
}: {
  reviewers: Reviewer[];
  onChange: (r: Reviewer[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function addReviewer(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const trimmed = email.trim().toLowerCase();
    const { data, error } = await supabase
      .from("reviewers")
      .insert({
        email: trimmed,
        display_name: name.trim() || null,
        is_admin: isAdmin,
      })
      .select()
      .single();
    if (error) {
      setMsg(`실패: ${error.message}`);
    } else {
      onChange(
        [...reviewers, data as Reviewer].sort((a, b) =>
          a.email.localeCompare(b.email),
        ),
      );
      setEmail("");
      setName("");
      setIsAdmin(false);
      setMsg("등록 완료 (기존 모든 샘플이 자동 배정됨)");
    }
  }

  async function toggleAdmin(r: Reviewer) {
    const { error } = await supabase
      .from("reviewers")
      .update({ is_admin: !r.is_admin })
      .eq("id", r.id);
    if (error) {
      setMsg(`실패: ${error.message}`);
    } else {
      onChange(
        reviewers.map((x) =>
          x.id === r.id ? { ...x, is_admin: !x.is_admin } : x,
        ),
      );
    }
  }

  async function removeReviewer(r: Reviewer) {
    if (
      !confirm(
        `${r.email} 을 삭제할까요?\n(이 리뷰어의 모든 assignment와 편집 기록도 함께 삭제됩니다)`,
      )
    )
      return;
    const { error } = await supabase.from("reviewers").delete().eq("id", r.id);
    if (error) {
      setMsg(`실패: ${error.message}`);
    } else {
      onChange(reviewers.filter((x) => x.id !== r.id));
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-3">리뷰어 등록</h2>
        <p className="text-xs text-gray-500 mb-3">
          여기서 미리 등록하거나, 사용자가 이메일로 직접 로그인하면 자동으로
          등록됩니다. 등록되는 즉시 기존 모든 샘플이 자동 배정됩니다.
        </p>
        <form onSubmit={addReviewer} className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-600 mb-1">이메일 *</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
              placeholder="reviewer@example.com"
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="block text-xs text-gray-600 mb-1">이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
              placeholder="김리뷰"
            />
          </div>
          <label className="flex items-center gap-1 text-sm py-1.5">
            <input
              type="checkbox"
              checked={isAdmin}
              onChange={(e) => setIsAdmin(e.target.checked)}
            />
            admin
          </label>
          <button
            type="submit"
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            등록
          </button>
        </form>
        {msg && (
          <div className="mt-3 text-sm text-gray-700 bg-gray-50 p-2 rounded">
            {msg}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-3">
          등록된 리뷰어 ({reviewers.length}명)
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2">이메일</th>
              <th className="text-left py-2 px-2">이름</th>
              <th className="text-left py-2 px-2">권한</th>
              <th className="text-left py-2 px-2">등록일</th>
              <th className="text-right py-2 px-2">액션</th>
            </tr>
          </thead>
          <tbody>
            {reviewers.map((r) => (
              <tr key={r.id} className="border-b border-gray-100">
                <td className="py-2 px-2 font-mono text-xs">{r.email}</td>
                <td className="py-2 px-2">{r.display_name || "—"}</td>
                <td className="py-2 px-2">
                  {r.is_admin ? (
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                      admin
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500">reviewer</span>
                  )}
                </td>
                <td className="py-2 px-2 text-xs text-gray-500">
                  {new Date(r.created_at).toLocaleDateString("ko-KR")}
                </td>
                <td className="py-2 px-2 text-right space-x-2">
                  <button
                    onClick={() => toggleAdmin(r)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {r.is_admin ? "admin 해제" : "admin 지정"}
                  </button>
                  <button
                    onClick={() => removeReviewer(r)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==========================================================================
// CSV 임포트 탭 — 배정 방식 없음. 임포트하면 모든 리뷰어에게 자동 배정.
// ==========================================================================

type ParsedRow = Record<string, string>;

function ImportTab({
  supabase,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
}) {
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const cols = result.meta.fields || [];
        const missing = REQUIRED_CSV_COLS.filter((c) => !cols.includes(c));
        if (missing.length > 0) {
          setStatus(
            `필수 컬럼 누락: ${missing.join(", ")}. CSV에 반드시 있어야 합니다.`,
          );
          setParsed([]);
          setColumns([]);
          return;
        }
        setColumns(cols);
        setParsed(result.data);
        setStatus(`파싱 완료: ${result.data.length} 행, ${cols.length} 컬럼`);
      },
      error: (err) => {
        setStatus(`파싱 오류: ${err.message}`);
      },
    });
  }

  async function doImport() {
    if (parsed.length === 0) return;
    if (
      !confirm(
        `${parsed.length} 개 샘플을 임포트합니다. 계속할까요?\n\n` +
          `임포트되면 등록된 모든 리뷰어에게 각 샘플이 자동 배정됩니다.\n` +
          `(기존 samples 는 지워지지 않고 추가됩니다. 완전 재임포트는 SQL에서 DELETE 후 실행)`,
      )
    )
      return;

    setStatus("업로드 중...");

    // top-level 컬럼 vs extra
    const rows = parsed.map((row, idx) => {
      const extra: Record<string, string> = {};
      const topLevel: Partial<Record<string, string | null>> = {};

      for (const [key, value] of Object.entries(row)) {
        if (key === "oph_record" || key === "gt") continue;
        // row_index / index 둘 다 인식
        if (key === "row_index" || key === "index")
          topLevel.row_index = value || null;
        else if (key === "연구별 환자 ID" || key === "patient_id")
          topLevel.patient_id = value || null;
        else if (key === "작성의" || key === "author")
          topLevel.author = value || null;
        else extra[key] = value ?? "";
      }

      return {
        row_index: topLevel.row_index ?? String(idx),
        patient_id: topLevel.patient_id ?? null,
        author: topLevel.author ?? null,
        oph_record: row.oph_record ?? "",
        gt: row.gt ?? "",
        extra,
      };
    });

    const chunkSize = 200; // 트리거가 무거우니 청크 크기 작게
    let inserted = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase.from("samples").insert(chunk);
      if (error) {
        setStatus(`오류 (${inserted}개 삽입됨): ${error.message}`);
        return;
      }
      inserted += chunk.length;
      setStatus(`${inserted}/${rows.length} 삽입 중... (리뷰어에게 자동 배정)`);
    }

    setStatus(
      `완료! ${inserted}개 샘플 임포트됨. 모든 리뷰어에게 자동 배정 완료.`,
    );
    setParsed([]);
    setColumns([]);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-3">CSV 임포트</h2>
        <p className="text-sm text-gray-600 mb-3">
          필수 컬럼: <code className="bg-gray-100 px-1">oph_record</code>,{" "}
          <code className="bg-gray-100 px-1">gt</code>. 그 외 컬럼(
          <code className="bg-gray-100 px-1">row_index</code>/
          <code className="bg-gray-100 px-1">index</code>,{" "}
          <code className="bg-gray-100 px-1">patient_id</code>/
          <code className="bg-gray-100 px-1">연구별 환자 ID</code>,{" "}
          <code className="bg-gray-100 px-1">author</code>/
          <code className="bg-gray-100 px-1">작성의</code>)은 자동 인식되며,
          나머지는 <code className="bg-gray-100 px-1">extra</code> JSONB에 저장.
        </p>
        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2 mb-3">
          💡 이 시스템은 <strong>각 리뷰어가 모든 샘플을 독립적으로</strong>{" "}
          라벨링합니다. CSV를 임포트하면 등록된 모든 리뷰어에게 자동 배정되며,
          이후 새로 가입하는 리뷰어에게도 자동 배정됩니다.
        </div>

        <input
          type="file"
          accept=".csv"
          onChange={onFile}
          className="block text-sm mb-3"
        />

        {status && (
          <div className="text-sm bg-gray-50 border border-gray-200 rounded p-3 mb-3">
            {status}
          </div>
        )}

        {parsed.length > 0 && (
          <>
            <div className="text-sm text-gray-600 mb-3">
              감지된 컬럼: {columns.join(", ")}
            </div>
            <button
              onClick={doImport}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              {parsed.length}개 샘플 임포트 (모든 리뷰어에게 자동 배정)
            </button>
          </>
        )}
      </div>
    </div>
  );
}
