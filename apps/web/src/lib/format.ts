import type { ItineraryItem, MealType, PublicItinerary, TravelParty } from "@rong/shared-types";

/** Nhãn khớp `apps/mobile/src/lib/trip-format.ts`. */
const TZ = "Asia/Ho_Chi_Minh";
const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

const TRAVEL_PARTY_LABELS: Record<TravelParty, string> = {
  friends: "Nhóm bạn",
  family_with_kids: "Gia đình có trẻ nhỏ",
  couple: "Cặp đôi",
  solo: "Một mình",
  with_elderly: "Có người lớn tuổi",
};

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Bữa sáng",
  lunch: "Bữa trưa",
  dinner: "Bữa tối",
};

/** Ngày, tháng, năm, giờ, phút theo giờ Việt Nam; ghép tay để không phụ thuộc định dạng ICU của từng máy. */
const PARTS = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TZ,
});

function vnParts(iso: string): Record<"year" | "month" | "day" | "hour" | "minute", string> {
  const parts = Object.fromEntries(
    PARTS.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return parts as Record<"year" | "month" | "day" | "hour" | "minute", string>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "08:30" theo giờ Việt Nam. */
export function formatTime(iso: string): string {
  const { hour, minute } = vnParts(iso);
  return `${hour}:${minute}`;
}

/** Ngày `YYYY-MM-DD` của lịch trình (đã là ngày theo giờ Việt Nam) → "Chủ Nhật, 04/10". */
export function formatPlanDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${pad(d)}/${pad(m)}`;
}

/** "04/10 – 05/10/2026", hoặc "04/10/2026" nếu cùng ngày. */
export function formatDateRange(startsAt: string, endsAt: string): string {
  const s = vnParts(startsAt);
  const e = vnParts(endsAt);
  const start = `${s.day}/${s.month}`;
  const end = `${e.day}/${e.month}`;
  return start === end ? `${start}/${e.year}` : `${start} – ${end}/${e.year}`;
}

/** "Nhóm bạn · 2 người lớn" / "… · 2 người lớn, 1 trẻ em". */
export function partyLabel(p: Pick<PublicItinerary, "travelParty" | "adults" | "children">): string {
  const people = [`${p.adults} người lớn`, ...(p.children > 0 ? [`${p.children} trẻ em`] : [])];
  return `${TRAVEL_PARTY_LABELS[p.travelParty]} · ${people.join(", ")}`;
}

/** Tên hiển thị của một mục; mục ăn/nghỉ chưa gắn địa điểm thì dùng nhãn. */
export function describeItem(item: ItineraryItem): string {
  if (item.place) return item.place.name;
  if (item.kind === "meal") return item.mealType ? MEAL_LABELS[item.mealType] : "Ăn uống";
  return "Nghỉ ngơi";
}
