import { Image, type ImageLoadEventData } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';

/** Khung ảnh tự theo tỉ lệ ảnh (`fit="natural"`): không cao hơn 4:5, không dẹt hơn 2:1. */
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 2;

type Props = {
  uri: string;
  /**
   * `natural`: chiều cao khung theo tỉ lệ ảnh (màn chi tiết), nên ảnh lấp kín mà
   * gần như không bị cắt. `box`: khung do `style` quyết định (thẻ, ô nhỏ), ảnh cắt cho kín.
   */
  fit: 'natural' | 'box';
  style?: StyleProp<ViewStyle>;
  /** Tỉ lệ khung khi chưa tải xong ảnh (`natural`). */
  initialRatio?: number;
  transition?: number;
  onError?: () => void;
};

/**
 * Ảnh từ bài viết trên web: không biết trước kích thước (server chỉ có URL), nên đọc
 * kích thước thật khi tải xong. Ảnh luôn lấp kín khung (`cover`); ảnh nhỏ được phóng
 * to theo khung.
 */
export function AdaptiveImage({ uri, fit, style, initialRatio = 16 / 9, transition = 200, onError }: Props) {
  const [ratio, setRatio] = useState<number | null>(null);
  const frameRatio = fit === 'natural' ? clamp(ratio ?? initialRatio, MIN_RATIO, MAX_RATIO) : null;

  return (
    <View style={[styles.frame, frameRatio ? { aspectRatio: frameRatio } : null, style]}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={transition}
        accessible={false}
        onLoad={
          fit === 'natural'
            ? (e: ImageLoadEventData) => setRatio(e.source.width / Math.max(e.source.height, 1))
            : undefined
        }
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
