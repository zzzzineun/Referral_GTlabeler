// tkinter 버전과 동일한 참고 텍스트.
// **...** 로 감싼 부분은 참고 박스에서 빨간 굵은 글씨로 렌더링됨 (placeholder).

export const FORMAT_TEMPLATE = `안녕하십니까 선생님, 환자 한 분 의뢰 드립니다.

상기 환자는 **[주요 진단/안과적 주요 소견]**이 관찰되며, **[수술/시술 과거력]** 이력이 있습니다. 현재 **[시력/안압 등 제공된 검사결과]** 이며, **[약물 투약 있는 경우]**을 사용하고 있습니다.

**[회송 이유를 간략하게 서술]**

바쁘신 와중에 부디 고진선처 부탁드립니다. 감사합니다.

**[회송 의사명]** 배상`;

export const EXAMPLE_TEXT = `안녕하십니까 선생님, 환자 한 분 의뢰 드립니다.

상기 환자는 좌안 BRVO가 관찰되며, 좌안 Avastin 주사를 2019년 4월 15일부터 2019년 10월 28일까지 총 3회 시행받은 이력이 있습니다. 현재 교정시력은 우안 1.0, 좌안 0.8이고 안압은 우안 Tn 13, 좌안 Tn 16입니다.

정기적인 경과관찰 위해 회송합니다.

바쁘신 와중에 부디 고진선처 부탁드립니다. 감사합니다.

박운철 배상`;

// samples 리스트 옆 색상 코드 (tkinter 버전과 동일한 팔레트)
export const STATUS_COLORS = {
  current: { bg: "bg-blue-300", fg: "text-gray-900" },
  excluded: { bg: "bg-red-200", fg: "text-red-900" },
  edited: { bg: "bg-amber-100", fg: "text-gray-900" },
  saved: { bg: "bg-gray-200", fg: "text-gray-500" },
  unsaved: { bg: "bg-white", fg: "text-gray-900" },
} as const;

// 참고 박스 안의 **...** 를 렌더링하기 위한 헬퍼
export function parseMarkdownBold(
  text: string,
): Array<{ text: string; bold: boolean }> {
  const parts = text.split("**");
  return parts
    .filter((p) => p.length > 0)
    .map((p, i) => ({ text: p, bold: i % 2 === 1 }));
}
