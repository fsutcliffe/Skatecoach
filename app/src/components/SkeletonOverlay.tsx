import React from 'react';
import Svg, { Circle, Line } from 'react-native-svg';
import { StyleSheet, View } from 'react-native';

interface Landmark {
  x: number;
  y: number;
  visibility: number;
}

interface SkeletonOverlayProps {
  landmarks: Landmark[] | null;
  connections: number[][];
  videoWidth: number;
  videoHeight: number;
  visible: boolean;
}

export default function SkeletonOverlay({
  landmarks,
  connections,
  videoWidth,
  videoHeight,
  visible,
}: SkeletonOverlayProps) {
  if (!visible || !landmarks || landmarks.length === 0) {
    return null;
  }

  // Filter to visible landmarks only (visibility >= 0.5)
  const visibleLandmarks = landmarks.map((lm: Landmark, i: number) => ({
    index: i,
    x: lm.x * videoWidth,
    y: lm.y * videoHeight,
    visibility: lm.visibility,
  }));

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="none">
      <Svg width={videoWidth} height={videoHeight}>
        {/* Draw bones (connections between landmarks) */}
        {connections.map(([fromIdx, toIdx]) => {
          const from = visibleLandmarks[fromIdx];
          const to = visibleLandmarks[toIdx];
          // Only draw if both endpoints have reasonable visibility
          if (!from || !to || from.visibility < 0.5 || to.visibility < 0.5) {
            return null;
          }
          return (
            <Line
              key={`bone-${fromIdx}-${toIdx}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="rgba(0, 255, 255, 0.7)"
              strokeWidth={2}
              strokeLinecap="round"
            />
          );
        })}

        {/* Draw joint dots */}
        {visibleLandmarks.map((lm) => {
          if (lm.visibility < 0.5) return null;
          return (
            <React.Fragment key={`joint-${lm.index}`}>
              {/* Outer circle (blue outline) */}
              <Circle
                cx={lm.x}
                cy={lm.y}
                r={3.5}
                fill="rgba(100, 149, 237, 0.9)"
                stroke="rgba(100, 149, 237, 0.9)"
                strokeWidth={1}
              />
              {/* Inner circle (white fill) */}
              <Circle
                cx={lm.x}
                cy={lm.y}
                r={2}
                fill="rgba(255, 255, 255, 0.85)"
              />
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
});
