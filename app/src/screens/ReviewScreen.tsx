import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  Dimensions,
  LayoutChangeEvent,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList, JumpClip, AnalysisResult } from '../types';
import { getClipUrl, getResults, getFrameData, FrameDataResponse } from '../services/api';
import SkeletonOverlay from '../components/SkeletonOverlay';

type ReviewRouteProp = RouteProp<RootStackParamList, 'Review'>;
type ReviewNavProp = NativeStackNavigationProp<RootStackParamList, 'Review'>;

const SCREEN_WIDTH = Dimensions.get('window').width;

export default function ReviewScreen() {
  const navigation = useNavigation<ReviewNavProp>();
  const route = useRoute<ReviewRouteProp>();
  const { sessionId } = route.params;

  const videoRef = useRef<Video>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Frame data for skeleton overlay
  const [frameData, setFrameData] = useState<FrameDataResponse | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState({ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 9 / 16 });
  const lastPlaybackTime = useRef(0);

  // Fetch results on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await getResults(sessionId);
        setResult(data);
        setLoading(false);
      } catch (err: any) {
        console.error('Failed to load results:', err);
        setError(err.message || 'Failed to load results');
        setLoading(false);
      }
    })();
  }, [sessionId]);

  // Fetch frame data when current jump changes
  useEffect(() => {
    if (!result || result.jumps.length === 0) return;
    const currentJump = result.jumps[currentIndex];
    if (!currentJump) return;

    (async () => {
      try {
        const data = await getFrameData(sessionId, currentJump.jump_index);
        setFrameData(data);
        setCurrentFrame(0);
      } catch (err: any) {
        console.error('Failed to load frame data:', err);
        setFrameData(null);
      }
    })();
  }, [sessionId, currentIndex, result]);

  const jumps = result?.jumps ?? [];
  const currentJump = jumps[currentIndex] ?? null;

  // Navigate jumps
  const goToJump = useCallback(
    (index: number) => {
      if (index >= 0 && index < jumps.length) {
        setCurrentIndex(index);
      }
    },
    [jumps.length]
  );

  const onPlaybackStatusUpdate = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded || !frameData) return;
      lastPlaybackTime.current = status.positionMillis / 1000; // seconds

      // Calculate current frame from playback time
      const frame = Math.floor(lastPlaybackTime.current * frameData.fps);
      const clampedFrame = Math.min(frame, frameData.total_clip_frames - 1);
      if (clampedFrame >= 0) {
        setCurrentFrame(clampedFrame);
      }
    },
    [frameData]
  );

  const replay = useCallback(async () => {
    if (videoRef.current) {
      await videoRef.current.setPositionAsync(0);
      await videoRef.current.playAsync();
    }
  }, []);

  const onVideoLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setVideoDimensions({ width, height });
  }, []);

  // Compute current frame's landmarks for skeleton overlay
  const currentLandmarks = frameData && frameData.landmarks && currentFrame < frameData.landmarks.length
    ? frameData.landmarks[currentFrame]
    : null;

  // ── Loading State ──
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4a4aff" />
          <Text style={styles.loadingText}>Loading results...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error State ──
  if (error || !result) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="alert-circle" size={60} color="#ff6666" />
          <Text style={styles.errorText}>{error || 'Unknown error'}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.retryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── No Jumps ──
  if (jumps.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="footsteps" size={60} color="#666688" />
          <Text style={styles.errorText}>No jumps found in this video.</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.retryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main Review UI ──
  const clipUrl = currentJump
    ? getClipUrl(sessionId, currentJump.clip_filename)
    : '';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Jump Review</Text>
        <Text style={styles.headerSubtitle}>
          Jump {currentIndex + 1} of {jumps.length}
        </Text>
      </View>

      {/* Video Player with Skeleton Overlay */}
      <View style={styles.videoContainer}>
        {clipUrl ? (
          <View style={styles.videoWrapper} onLayout={onVideoLayout}>
            <Video
              ref={videoRef}
              source={{ uri: clipUrl }}
              style={styles.video}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              shouldPlay
              onPlaybackStatusUpdate={onPlaybackStatusUpdate}
            />
            <SkeletonOverlay
              landmarks={currentLandmarks}
              connections={frameData?.connections ?? []}
              videoWidth={videoDimensions.width}
              videoHeight={videoDimensions.height}
              visible={showSkeleton && frameData !== null}
            />
          </View>
        ) : (
          <View style={styles.videoPlaceholder}>
            <Ionicons name="videocam-outline" size={48} color="#666688" />
          </View>
        )}
      </View>

      {/* Info Cards */}
      {currentJump && (
        <View style={styles.infoRow}>
          <View style={styles.infoCard}>
            <Text style={styles.infoValue}>
              {(currentJump.confidence * 100).toFixed(0)}%
            </Text>
            <Text style={styles.infoLabel}>Confidence</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoValue}>
              {currentJump.duration.toFixed(1)}s
            </Text>
            <Text style={styles.infoLabel}>Duration</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoValue}>
              {currentJump.apex_time.toFixed(2)}s
            </Text>
            <Text style={styles.infoLabel}>Apex Time</Text>
          </View>
        </View>
      )}

      {/* Navigation Controls */}
      <View style={styles.navControls}>
        <TouchableOpacity
          style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}
          onPress={() => goToJump(currentIndex - 1)}
          disabled={currentIndex === 0}
        >
          <Ionicons
            name="play-skip-back"
            size={22}
            color={currentIndex === 0 ? '#444466' : '#ffffff'}
          />
          <Text
            style={[
              styles.navButtonLabel,
              currentIndex === 0 && styles.navButtonLabelDisabled,
            ]}
          >
            Previous
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.replayButton} onPress={replay}>
          <Ionicons name="refresh" size={22} color="#ffffff" />
          <Text style={styles.replayLabel}>Replay</Text>
        </TouchableOpacity>

        {/* Skeleton Toggle */}
        <TouchableOpacity
          style={[
            styles.skeletonButton,
            showSkeleton && styles.skeletonButtonActive,
          ]}
          onPress={() => setShowSkeleton(!showSkeleton)}
        >
          <Ionicons
            name="body-outline"
            size={22}
            color={showSkeleton ? '#ffffff' : '#8888cc'}
          />
          <Text
            style={[
              styles.skeletonLabel,
              showSkeleton && styles.skeletonLabelActive,
            ]}
          >
            Skeleton
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navButton,
            currentIndex === jumps.length - 1 && styles.navButtonDisabled,
          ]}
          onPress={() => goToJump(currentIndex + 1)}
          disabled={currentIndex === jumps.length - 1}
        >
          <Text
            style={[
              styles.navButtonLabel,
              currentIndex === jumps.length - 1 && styles.navButtonLabelDisabled,
            ]}
          >
            Next
          </Text>
          <Ionicons
            name="play-skip-forward"
            size={22}
            color={
              currentIndex === jumps.length - 1 ? '#444466' : '#ffffff'
            }
          />
        </TouchableOpacity>
      </View>

      {/* Jump Chip List */}
      <View style={styles.chipListContainer}>
        <Text style={styles.chipListTitle}>Jumps</Text>
        <FlatList
          data={jumps}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => String(item.jump_index)}
          contentContainerStyle={styles.chipList}
          renderItem={({ item, index }) => {
            const isActive = index === currentIndex;
            return (
              <TouchableOpacity
                style={[styles.chip, isActive && styles.chipActive]}
                onPress={() => goToJump(index)}
              >
                <Text
                  style={[styles.chipText, isActive && styles.chipTextActive]}
                >
                  #{item.jump_index}
                </Text>
                <Text
                  style={[
                    styles.chipDuration,
                    isActive && styles.chipDurationActive,
                  ]}
                >
                  {item.duration.toFixed(1)}s
                </Text>
              </TouchableOpacity>
            );
          }}
        />
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
    gap: 12,
  },
  loadingText: {
    color: '#cccccc',
    fontSize: 16,
    marginTop: 12,
  },
  errorText: {
    color: '#ff6666',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#4a4aff',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 10,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
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
  videoContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 16 / 9,
    maxHeight: 500,
    backgroundColor: '#000000',
  },
  videoWrapper: {
    flex: 1,
    position: 'relative',
  },
  video: {
    flex: 1,
  },
  videoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111133',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  infoCard: {
    flex: 1,
    backgroundColor: '#1a1a3e',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  infoValue: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  infoLabel: {
    color: '#8888cc',
    fontSize: 11,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  navControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2d2d5e',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  navButtonDisabled: {
    backgroundColor: '#15153a',
  },
  navButtonLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  navButtonLabelDisabled: {
    color: '#444466',
  },
  replayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4a4aff',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  replayLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  skeletonButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2d2d5e',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#444466',
  },
  skeletonButtonActive: {
    backgroundColor: '#3a3a7e',
    borderColor: '#4a4aff',
  },
  skeletonLabel: {
    color: '#8888cc',
    fontSize: 12,
    fontWeight: '600',
  },
  skeletonLabelActive: {
    color: '#ffffff',
  },
  chipListContainer: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1a1a3e',
  },
  chipListTitle: {
    color: '#8888cc',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginLeft: 16,
    marginBottom: 8,
  },
  chipList: {
    paddingHorizontal: 12,
    gap: 8,
  },
  chip: {
    backgroundColor: '#1a1a3e',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    minWidth: 60,
    borderWidth: 1,
    borderColor: '#2d2d5e',
  },
  chipActive: {
    backgroundColor: '#2d2d5e',
    borderColor: '#4a4aff',
  },
  chipText: {
    color: '#8888cc',
    fontSize: 15,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  chipDuration: {
    color: '#666688',
    fontSize: 11,
    marginTop: 2,
  },
  chipDurationActive: {
    color: '#aabbee',
  },
});
