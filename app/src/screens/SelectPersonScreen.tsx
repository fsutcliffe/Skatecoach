import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  Dimensions,
  GestureResponderEvent,
} from 'react-native';
import Svg, { Rect, Circle, Line } from 'react-native-svg';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList, PersonDetection } from '../types';
import { detectPeople } from '../services/api';

type SelectPersonRouteProp = RouteProp<RootStackParamList, 'SelectPerson'>;
type SelectPersonNavProp = NativeStackNavigationProp<RootStackParamList, 'SelectPerson'>;

const SCREEN_WIDTH = Dimensions.get('window').width;

// Colors per person index
const PERSON_COLORS = [
  { fill: 'rgba(74, 74, 255, 0.25)', stroke: '#4a4aff' },
  { fill: 'rgba(0, 200, 83, 0.25)', stroke: '#00c853' },
  { fill: 'rgba(255, 152, 0, 0.25)', stroke: '#ff9800' },
  { fill: 'rgba(156, 39, 176, 0.25)', stroke: '#9c27b0' },
  { fill: 'rgba(233, 30, 99, 0.25)', stroke: '#e91e63' },
  { fill: 'rgba(0, 188, 212, 0.25)', stroke: '#00bcd4' },
];

const SKELETON_CONNECTIONS = [
  [0, 1], [0, 2], [1, 3], [2, 4], [0, 5], [0, 6],
  [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12], [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [27, 29], [27, 31], [24, 26], [26, 28], [28, 30],
  [28, 32],
  [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22],
];

export default function SelectPersonScreen() {
  const navigation = useNavigation<SelectPersonNavProp>();
  const route = useRoute<SelectPersonRouteProp>();
  const { videoUri } = route.params;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [detections, setDetections] = useState<PersonDetection[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [imageLayout, setImageLayout] = useState({ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 16 / 9 });
  const [frameWidth, setFrameWidth] = useState(0);
  const [frameHeight, setFrameHeight] = useState(0);

  // Fetch person detections on mount
  useEffect(() => {
    (async () => {
      try {
        const result = await detectPeople(videoUri);
        setFrameDataUrl(result.frame);
        setDetections(result.detections);
        setFrameWidth(result.frame_width);
        setFrameHeight(result.frame_height);

        // Auto-select if only one person detected
        if (result.detections.length === 1) {
          setSelectedIndex(0);
        }

        setLoading(false);
      } catch (err: any) {
        console.error('Person detection error:', err);
        Alert.alert('Detection Failed', err.message || 'Failed to detect people in video.');
        setError(err.message || 'Detection failed');
        setLoading(false);
      }
    })();
  }, [videoUri]);

  // Calculate image display dimensions (fit width, maintain aspect ratio)
  const onImageLayout = useCallback((event: any) => {
    const { width } = event.nativeEvent.layout;
    if (frameHeight > 0 && frameWidth > 0) {
      const aspectRatio = frameHeight / frameWidth;
      setImageLayout({ width, height: width * aspectRatio });
    }
  }, [frameWidth, frameHeight]);

  // Handle tap on image to select person
  const handleTap = useCallback((event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;

    // Convert tap coordinates to normalized 0-1
    const normX = locationX / imageLayout.width;
    const normY = locationY / imageLayout.height;

    // Find which person's bbox contains the tap point
    for (let i = detections.length - 1; i >= 0; i--) {
      const det = detections[i];
      const bx = det.bbox.x;
      const by = det.bbox.y;
      const bw = det.bbox.width;
      const bh = det.bbox.height;

      if (
        normX >= bx &&
        normX <= bx + bw &&
        normY >= by &&
        normY <= by + bh
      ) {
        setSelectedIndex(i);
        return;
      }
    }
  }, [detections, imageLayout]);

  // Navigate to processing with selected person
  const handleAnalyze = useCallback(() => {
    if (selectedIndex === null) {
      Alert.alert('Select a Person', 'Tap on a person in the video frame to select them for tracking.');
      return;
    }
    navigation.navigate('Processing', {
      videoUri,
      personIndex: selectedIndex,
    });
  }, [navigation, videoUri, selectedIndex]);

  // ── Loading State ──
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4a4aff" />
          <Text style={styles.statusText}>Detecting people in video...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error State ──
  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="alert-circle" size={60} color="#ff6666" />
          <Text style={styles.errorText}>Detection Failed</Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── No People Detected ──
  if (detections.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="people-outline" size={60} color="#666688" />
          <Text style={styles.errorText}>No people detected in this video.</Text>
          <Text style={styles.hintText}>Try a different video or skip to analyze anyway.</Text>
          <TouchableOpacity
            style={styles.analyzeButton}
            onPress={() => navigation.navigate('Processing', { videoUri })}
          >
            <Text style={styles.analyzeButtonText}>Skip & Analyze</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main Select Person UI ──
  const svgWidth = imageLayout.width;
  const svgHeight = imageLayout.height;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Select Person</Text>
        <Text style={styles.headerSubtitle}>
          Tap the person you want to track
        </Text>
      </View>

      {/* Frame with overlay */}
      <View style={styles.imageContainer} onLayout={onImageLayout}>
        {frameDataUrl && (
          <Image
            source={{ uri: frameDataUrl }}
            style={[styles.frameImage, { width: imageLayout.width, height: imageLayout.height }]}
            resizeMode="contain"
          />
        )}

        {/* SVG overlay for bboxes, skeletons, and tap handling */}
        <View
          style={[
            styles.overlayContainer,
            { width: imageLayout.width, height: imageLayout.height },
          ]}
          onStartShouldSetResponder={() => true}
          onResponderRelease={handleTap}
        >
          <Svg width={svgWidth} height={svgHeight}>
            {detections.map((det, index) => {
              const isSelected = selectedIndex === index;
              const colors = PERSON_COLORS[index % PERSON_COLORS.length];

              // Convert normalized bbox to pixel coords
              const rx = det.bbox.x * svgWidth;
              const ry = det.bbox.y * svgHeight;
              const rw = det.bbox.width * svgWidth;
              const rh = det.bbox.height * svgHeight;

              return (
                <React.Fragment key={`person-${index}`}>
                  {/* Bounding box */}
                  <Rect
                    x={rx}
                    y={ry}
                    width={rw}
                    height={rh}
                    fill={colors.fill}
                    stroke={isSelected ? '#ffffff' : colors.stroke}
                    strokeWidth={isSelected ? 3 : 2}
                    strokeDasharray={isSelected ? undefined : '6,3'}
                  />

                  {/* Skeleton landmarks */}
                  {det.landmarks.length > 0 && (
                    <>
                      {/* Draw connections */}
                      {SKELETON_CONNECTIONS.map(([fromIdx, toIdx]) => {
                        const from = det.landmarks[fromIdx];
                        const to = det.landmarks[toIdx];
                        if (!from || !to || from.visibility < 0.5 || to.visibility < 0.5) return null;
                        return (
                          <Line
                            key={`skel-${index}-${fromIdx}-${toIdx}`}
                            x1={from.x * svgWidth}
                            y1={from.y * svgHeight}
                            x2={to.x * svgWidth}
                            y2={to.y * svgHeight}
                            stroke={isSelected ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 255, 255, 0.6)'}
                            strokeWidth={isSelected ? 2.5 : 1.5}
                            strokeLinecap="round"
                          />
                        );
                      })}

                      {/* Draw joint dots */}
                      {det.landmarks.map((lm, lmi) => {
                        if (lm.visibility < 0.5) return null;
                        return (
                          <Circle
                            key={`joint-${index}-${lmi}`}
                            cx={lm.x * svgWidth}
                            cy={lm.y * svgHeight}
                            r={isSelected ? 3 : 2}
                            fill={
                              isSelected
                                ? 'rgba(255, 255, 255, 0.9)'
                                : 'rgba(100, 149, 237, 0.8)'
                            }
                          />
                        );
                      })}
                    </>
                  )}
                </React.Fragment>
              );
            })}
          </Svg>
        </View>

        {/* Person label indicators */}
        <View style={styles.labelContainer}>
          {detections.map((det, index) => {
            const isSelected = selectedIndex === index;
            const colors = PERSON_COLORS[index % PERSON_COLORS.length];
            const labelX = det.bbox.x * imageLayout.width;
            const labelY = Math.max(0, (det.bbox.y - 0.05) * imageLayout.height);

            return (
              <View
                key={`label-${index}`}
                style={[
                  styles.personLabel,
                  {
                    left: labelX,
                    top: labelY,
                    backgroundColor: isSelected ? '#ffffff' : colors.stroke,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.personLabelText,
                    { color: isSelected ? '#0f0f23' : '#ffffff' },
                  ]}
                >
                  Person {index + 1}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Hint */}
      <View style={styles.hintRow}>
        <Ionicons name="hand-left-outline" size={18} color="#8888cc" />
        <Text style={styles.hintText}>Tap on a person in the image above</Text>
      </View>

      {/* Analyze Button */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[
            styles.analyzeButton,
            selectedIndex === null && styles.analyzeButtonDisabled,
          ]}
          onPress={handleAnalyze}
          disabled={selectedIndex === null}
        >
          <Ionicons name="analytics-outline" size={22} color="#ffffff" />
          <Text style={styles.analyzeButtonText}>
            Analyze {selectedIndex !== null ? `Person ${selectedIndex + 1}` : 'Selected Person'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ──
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f23',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
    gap: 15,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a3e',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#8888cc',
    marginTop: 2,
  },
  imageContainer: {
    position: 'relative',
    backgroundColor: '#000000',
    alignSelf: 'center',
  },
  frameImage: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  overlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  labelContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  personLabel: {
    position: 'absolute',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  personLabelText: {
    fontSize: 11,
    fontWeight: '700',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  hintText: {
    color: '#8888cc',
    fontSize: 13,
    textAlign: 'center',
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#1a1a3e',
  },
  analyzeButton: {
    backgroundColor: '#4a4aff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
  },
  analyzeButtonDisabled: {
    backgroundColor: '#2d2d5e',
    opacity: 0.5,
  },
  analyzeButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  statusText: {
    color: '#cccccc',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 12,
  },
  errorText: {
    color: '#ff6666',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  backButton: {
    backgroundColor: '#4a4aff',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 10,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
});
