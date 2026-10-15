const KST_OFFSET_MIN = 9 * 60;

export function parseHHMM(s: string): number {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`시각 형식(HH:MM)이 아닙니다: ${s}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`올바르지 않은 시각: ${s}`);
  return h * 60 + min;
}

/** KST 기준 영업일(YYYY-MM-DD). business_day_start 이전 새벽은 전날 영업일로 봅니다 */
export function businessDay(now: Date, businessDayStart: string): string {
  const shifted = new Date(now.getTime() + (KST_OFFSET_MIN - parseHHMM(businessDayStart)) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** 영업일 시작 시각의 UTC ISO 문자열 (D1 datetime 비교용 'YYYY-MM-DD HH:MM:SS') */
export function businessDayStartUtc(now: Date, businessDayStart: string): string {
  const day = businessDay(now, businessDayStart);
  const startMin = parseHHMM(businessDayStart);
  const utc = new Date(`${day}T00:00:00Z`).getTime() + (startMin - KST_OFFSET_MIN) * 60_000;
  return new Date(utc).toISOString().replace('T', ' ').slice(0, 19);
}

/** 이번 영업일의 마감 시각이 지났고 아직 리포트를 안 보냈으면 true */
export function isReportDue(now: Date, closingTime: string, businessDayStart: string, lastReportDay: string): boolean {
  const day = businessDay(now, businessDayStart);
  if (lastReportDay === day) return false;
  const kstMin = Math.floor(((now.getTime() / 60_000 + KST_OFFSET_MIN) % 1440 + 1440) % 1440);
  const start = parseHHMM(businessDayStart);
  const sinceStart = (kstMin - start + 1440) % 1440;
  const closeSinceStart = (parseHHMM(closingTime) - start + 1440) % 1440;
  return sinceStart >= closeSinceStart;
}

export function formatKst(d: Date): string {
  const k = new Date(d.getTime() + KST_OFFSET_MIN * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}
