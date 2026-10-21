import type { ItineraryItem, PublicItinerary } from "@rong/shared-types";
import { describe, expect, it } from "vitest";

import { describeItem, formatDateRange, formatPlanDate, formatTime, notesLine, partyLabel } from "./format";

const item = (over: Partial<ItineraryItem>): ItineraryItem => ({
  id: "1",
  kind: "visit",
  placeId: "p",
  place: null,
  dayPart: "morning",
  order: 0,
  startsAt: "2026-10-04T01:30:00.000Z",
  endsAt: "2026-10-04T02:30:00.000Z",
  isAiSuggested: false,
  ...over,
});

describe("format", () => {
  it("giờ theo múi giờ Việt Nam", () => {
    expect(formatTime("2026-10-04T01:30:00.000Z")).toBe("08:30");
    expect(formatTime("2026-10-04T15:05:00.000Z")).toBe("22:05");
  });

  it("ngày của lịch trình", () => {
    expect(formatPlanDate("2026-10-04")).toBe("Chủ Nhật, 04/10");
  });

  it("khoảng ngày, gộp khi cùng ngày", () => {
    expect(formatDateRange("2026-10-04T01:00:00.000Z", "2026-10-05T12:00:00.000Z")).toBe(
      "04/10 – 05/10/2026",
    );
    expect(formatDateRange("2026-10-04T01:00:00.000Z", "2026-10-04T12:00:00.000Z")).toBe(
      "04/10/2026",
    );
  });

  it("đối tượng đi", () => {
    const family = { travelParty: "family_with_kids", adults: 2, children: 1 } as PublicItinerary;
    expect(partyLabel(family)).toBe("Gia đình có trẻ nhỏ · 2 người lớn, 1 trẻ em");
    const friends = { travelParty: "friends", adults: 4, children: 0 } as PublicItinerary;
    expect(partyLabel(friends)).toBe("Nhóm bạn · 4 người lớn");
  });

  it("mục không gắn địa điểm vẫn có tên", () => {
    expect(
      describeItem(item({ place: { name: "Hồ Xuân Hương", category: "nature", coordinates: null } })),
    ).toBe("Hồ Xuân Hương");
    expect(describeItem(item({ kind: "meal", mealType: "lunch" }))).toBe("Bữa trưa");
    expect(describeItem(item({ kind: "rest", placeId: null }))).toBe("Nghỉ ngơi");
  });
});

describe("notesLine", () => {
  it("ghi chú, giờ và giá của người tạo trên một dòng", () => {
    expect(
      notesLine({ note: "Đi sớm", openingHours: "Mo-Su 06:00-09:00", priceMin: 20000, priceMax: 40000 }),
    ).toBe("Đi sớm · Giờ: Mo-Su 06:00-09:00 · Giá: 20.000–40.000 đ");
  });

  it("chỉ có giá từ, hoặc miễn phí", () => {
    expect(notesLine({ note: null, openingHours: null, priceMin: 300000, priceMax: null })).toBe("Giá: từ 300.000 đ");
    expect(notesLine({ note: null, openingHours: null, priceMin: 0, priceMax: 0 })).toBe("Giá: miễn phí");
  });

  it("không có ghi chú → null", () => {
    expect(notesLine(null)).toBeNull();
    expect(notesLine(undefined)).toBeNull();
  });
});
