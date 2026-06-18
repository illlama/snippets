import SVGTrashSquare from '@/assets/icons/SVGTrashSquare';
import React from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

// Gesture and scale tuning
const ASSET_SCALE_MIN = 0.3;
const ASSET_SCALE_MAX = 3.0; // increased upper bound for larger pinch scaling
const PINCH_HITSLOP_PX = 30; // expand pinch recognition area
const PINCH_PAD_PX = 28; // visually expand gesture area via outer padding

type DraggableAssetProps = {
  id: string;
  uri: string;
  baseLeft: number;
  baseTop: number;
  imageSize: number;
  badgeSize: number;
  isSelected: boolean;
  onToggleSelect: () => void;
  onRemove: () => void;
  usableWidth: number;
  usableHeight: number;
  centerX: number;
  centerY: number;
  ringRadius: number;
  ringRadiusMeters: number;
  xyWeight: number;
  textTx: SharedValue<number>;
  textTy: SharedValue<number>;
  initialScale?: number;
  onEmitOffsets?: (update: {
    id: string;
    offsetMeters?: { x: number; y: number; z: number };
    screen?: { nx: number; ny: number };
    scale?: number;
  }) => void;
  anim: { opacity: Animated.Value; scale: Animated.Value };
  disabled?: boolean;
  anotherSelected?: boolean;
};

export default function DraggableAsset(props: DraggableAssetProps) {
  const {
    id,
    uri,
    baseLeft,
    baseTop,
    imageSize,
    badgeSize,
    isSelected,
    onToggleSelect,
    onRemove,
    usableWidth,
    usableHeight,
    centerX,
    centerY,
    ringRadius,
    ringRadiusMeters,
    xyWeight,
    textTx,
    textTy,
    initialScale,
    onEmitOffsets,
    anim,
    disabled = false,
    anotherSelected = false
  } = props;

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  // Use Reanimated shared value for pinch scale
  const pinchScale = useSharedValue(1);
  // Shared value (not a ref): the pinch callbacks run as worklets on the UI
  // thread, so the base scale must live in a shared value — a JS-thread ref
  // write (e.g. the effect below) wouldn't reach the worklet's copy.
  const baseScale = useSharedValue(1);

  React.useEffect(() => {
    const init = typeof initialScale === 'number' && isFinite(initialScale!) && initialScale! > 0 ? initialScale! : 1;
    pinchScale.value = init;
    baseScale.value = init;
  }, [initialScale]);

  const pan = Gesture.Pan()
    .enabled(!disabled && !isSelected && !anotherSelected)
    .minPointers(1)
    .maxPointers(1)
    .onBegin(() => {
      sx.value = tx.value;
      sy.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = sx.value + e.translationX;
      ty.value = sy.value + e.translationY;
    })
    .onEnd(() => {
      if (!onEmitOffsets) return;
      const cx = baseLeft + tx.value + imageSize / 2;
      const cy = baseTop + ty.value + imageSize / 2;
      const nx = Math.max(0, Math.min(1, cx / usableWidth));
      const ny = Math.max(0, Math.min(1, cy / usableHeight));
      const dxPx = cx - (centerX + textTx.value);
      const dyPx = cy - (centerY + textTy.value);
      const safeRadius = Math.max(1, ringRadius); // avoid divide-by-zero
      const dxMeters = (dxPx / safeRadius) * ringRadiusMeters * xyWeight;
      const dyMeters = (dyPx / safeRadius) * ringRadiusMeters * xyWeight;

      runOnJS(onEmitOffsets)({ id, offsetMeters: { x: dxMeters, y: dyMeters, z: 0 }, screen: { nx, ny } });
    });

  const pinch = Gesture.Pinch()
    .enabled(!disabled && isSelected)
    .hitSlop(PINCH_HITSLOP_PX)
    .onBegin(() => {
      baseScale.value = pinchScale.value;
    })
    .onUpdate((e) => {
      const next = Math.max(ASSET_SCALE_MIN, Math.min(ASSET_SCALE_MAX, (baseScale.value || 1) * e.scale));
      pinchScale.value = next;
    })
    .onEnd((e) => {
      const final = Math.max(ASSET_SCALE_MIN, Math.min(ASSET_SCALE_MAX, (baseScale.value || 1) * e.scale));
      pinchScale.value = final;
      baseScale.value = final;
      if (onEmitOffsets) {
        runOnJS(onEmitOffsets)({ id, scale: final });
      }
    });

  // 드래그와 탭의 상호 배타: threshold 이상 움직이면 탭 선택이 발생하지 않도록 처리
  const TAP_MOVE_THRESHOLD = 6;
  const tap = Gesture.Tap()
    .enabled(!disabled)
    .numberOfTaps(1)
    .maxDeltaX(TAP_MOVE_THRESHOLD)
    .maxDeltaY(TAP_MOVE_THRESHOLD)
    .onEnd((e, success) => {
      if (!success) return;
      runOnJS(onToggleSelect)();
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }]
  }));

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pinchScale.value }]
  }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, Gesture.Simultaneous(pinch, tap))}>
      <Reanimated.View
        style={[
          {
            position: 'absolute',
            left: baseLeft - (isSelected ? PINCH_PAD_PX : 0),
            top: baseTop - (isSelected ? PINCH_PAD_PX : 0),
            width: imageSize + (isSelected ? PINCH_PAD_PX * 2 : 0),
            height: imageSize + (isSelected ? PINCH_PAD_PX * 2 : 0),
            alignItems: 'center',
            justifyContent: 'center'
          },
          animStyle
        ]}
        pointerEvents={disabled ? 'none' : 'auto'}
      >
        <Reanimated.View style={[{ width: imageSize, height: imageSize, position: 'relative' }, contentStyle]}>
          <Animated.Image
            source={{ uri }}
            style={[styles.image, { opacity: anim.opacity, transform: [{ scale: anim.scale }] }]}
            resizeMode="contain"
          />
          {isSelected && (
            <Pressable
              onPress={onRemove}
              style={[styles.selectedBadge, { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2 }]}
            >
              <Svg
                width={badgeSize}
                height={badgeSize}
                viewBox={`0 0 ${badgeSize} ${badgeSize}`}
                style={StyleSheet.absoluteFill}
              >
                <Defs>
                  <RadialGradient id="badgeGrad" cx="50%" cy="50%" r="50%">
                    <Stop offset="0%" stopColor="#000" stopOpacity={0.8} />
                    <Stop offset="30%" stopColor="#000" stopOpacity={0.4} />
                    <Stop offset="70%" stopColor="#000" stopOpacity={0.15} />
                    <Stop offset="100%" stopColor="#000" stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx={badgeSize / 2} cy={badgeSize / 2} r={badgeSize / 2} fill="url(#badgeGrad)" />
              </Svg>
              <SVGTrashSquare width={20} color={'#fff'} />
            </Pressable>
          )}
        </Reanimated.View>
      </Reanimated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  image: {
    ...StyleSheet.absoluteFillObject
  },
  selectedBadge: {
    position: 'absolute',
    right: -8,
    bottom: -8,
    alignItems: 'center',
    justifyContent: 'center'
  }
});
