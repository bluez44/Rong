import { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, ReduceMotion } from 'react-native-reanimated';

/**
 * Chuyển động dùng chung của app: ngắn, ease-out, và luôn theo cài đặt "Giảm chuyển động"
 * của hệ điều hành (`ReduceMotion.System`: bật thì nhảy thẳng tới trạng thái cuối).
 */
export const Duration = {
  /** Nhấn nút / thẻ. */
  press: 120,
  /** Đổi trạng thái nhỏ: chip, màu nền. */
  quick: 180,
  /** Nội dung xuất hiện / biến mất. */
  base: 260,
} as const;

/** Khoảng cách giữa các mục khi hiện lần lượt (danh sách thẻ). */
const STAGGER_MS = 70;

const EaseOut = Easing.out(Easing.cubic);

export const timing = { easing: EaseOut, reduceMotion: ReduceMotion.System } as const;

/** Mục thứ `index` của danh sách hiện dần từ dưới lên. */
export const enterItem = (index = 0) =>
  FadeInDown.duration(Duration.base)
    .delay(Math.min(index, 6) * STAGGER_MS)
    .easing(EaseOut)
    .reduceMotion(ReduceMotion.System);

export const fadeIn = FadeIn.duration(Duration.base).easing(EaseOut).reduceMotion(ReduceMotion.System);
export const fadeOut = FadeOut.duration(Duration.quick).reduceMotion(ReduceMotion.System);

/** Các mục còn lại dịch chỗ mượt khi một mục được thêm/bớt. */
export const layoutShift = LinearTransition.duration(Duration.base).easing(EaseOut).reduceMotion(ReduceMotion.System);
