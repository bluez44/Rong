import { Image, type ImageLoadEventData } from 'expo-image';
import { useState } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';

/** Khung ảnh tự theo tỉ lệ ảnh (`fit="natural"`): không cao hơn 4:5, không dẹt hơn 2:1. */
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 2;
/** Tỉ lệ ảnh lệch khung quá mức này thì hiện trọn ảnh thay vì cắt. */
const MAX_CROP = 1.6;
/** Ảnh nhỏ hơn chừng này phần khung (theo pixel thật) thì không phóng to cho mờ. */
const MIN_FILL = 0.6;

type Props = {
  uri: string;
  /**
   * `natural`: chiều cao khung theo tỉ lệ ảnh (màn chi tiết).
   * `box`: khung do `style` quyết định (thẻ, ô nhỏ trong danh sách).
   */
  fit: 'natural' | 'box';
  style?: StyleProp<ViewStyle>;
  /** Tỉ lệ khung khi chưa tải xong ảnh (`natural`). */
  initialRatio?: number;
  transition?: number;
  onError?: () => void;
};

/**
 * Ảnh từ bài viết trên web: không biết trước kích thước (server chỉ có URL).
 * Tải xong thì đọc kích thước thật: ảnh vừa khung thì cắt cho kín (`cover`); ảnh
 * quá dọc, quá dẹt hoặc quá nhỏ thì hiện trọn, không phóng to (`scale-down`),
 * nền là chính ảnh làm mờ để khung không bị trống.
 */
export function AdaptiveImage({ uri, fit, style, initialRatio = 16 / 9, transition = 200, onError }: Props) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  const ratio = size ? size.width / Math.max(size.height, 1) : null;
  const frameRatio = fit === 'natural' ? clamp(ratio ?? initialRatio, MIN_RATIO, MAX_RATIO) : null;
  const boxRatio = fit === 'natural' ? frameRatio : box ? box.width / Math.max(box.height, 1) : null;

  let letterbox = false;
  if (size && ratio && boxRatio && box) {
    const mismatch = Math.max(ratio / boxRatio, boxRatio / ratio);
    const tooSmall = size.width < box.width * PixelRatio.get() * MIN_FILL;
    letterbox = mismatch > MAX_CROP || tooSmall;
  }

  return (
    <View
      style={[styles.frame, frameRatio ? { aspectRatio: frameRatio } : null, style]}
      onLayout={(e: LayoutChangeEvent) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {letterbox ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={24} accessible={false} />
      ) : null}
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit={letterbox ? 'scale-down' : 'cover'}
        transition={transition}
        accessible={false}
        onLoad={(e: ImageLoadEventData) => setSize({ width: e.source.width, height: e.source.height })}
        onError={onError}
      />
    </View>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  frame: { width: '100%', overflow: 'hidden', backgroundColor: Colors.light.backgroundSelected },
});
