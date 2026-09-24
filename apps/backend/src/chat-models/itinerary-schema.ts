import * as z from 'zod';

/** Kết quả Gemini trả về khi sắp xếp lịch trình — xem itineraries/ai-planner.ts. */
export const ItineraryPlan = z.object({
  days: z
    .array(
      z.object({
        dayIndex: z.number().int().describe('Số thứ tự ngày, bắt đầu từ 0'),
        stops: z
          .array(
            z.object({
              placeId: z
                .string()
                .describe(
                  'id địa điểm, chỉ dùng id có trong danh sách được cung cấp',
                ),
              visitMinutes: z
                .number()
                .int()
                .describe('Thời lượng tham quan hợp lý, phút'),
              reason: z
                .string()
                .describe(
                  'Lý do ngắn (dưới 20 từ, tiếng Việt) vì sao nên ghé và ghé lúc này',
                ),
              openingHours: z
                .string()
                .describe(
                  'Giờ mở cửa hằng ngày dạng "HH:mm-HH:mm" nếu tra được trên Google Maps, để trống nếu không rõ',
                ),
            }),
          )
          .describe('Các điểm theo đúng thứ tự nên đi trong ngày'),
      }),
    )
    .describe('Lịch từng ngày'),
  tips: z
    .array(z.string())
    .describe(
      'Tối đa 5 mẹo ngắn cho chuyến đi (thời tiết, trang phục, đặt chỗ…)',
    ),
});

export type ItineraryPlanType = z.infer<typeof ItineraryPlan>;
