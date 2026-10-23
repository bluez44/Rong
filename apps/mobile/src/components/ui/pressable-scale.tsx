import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Duration, timing } from '@/constants/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Tỉ lệ khi đang nhấn. */
  scaleTo?: number;
};

/** Pressable thu nhỏ nhẹ khi nhấn rồi bật lại, thay cho đổi `transform` tức thì. */
export function PressableScale({ style, scaleTo = 0.97, disabled, onPressIn, onPressOut, ...rest }: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        if (!disabled) scale.set(withTiming(scaleTo, { ...timing, duration: Duration.press }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withTiming(1, { ...timing, duration: Duration.quick }));
        onPressOut?.(e);
      }}
      style={[style, animated]}
    />
  );
}
