"""
Jump analysis using MediaPipe Pose.

Tracks the mid-hip landmark through video frames to detect jump apexes,
then trims clips around each detected jump.
"""

import dataclasses
import logging
import os
from typing import Any, List, Optional, Tuple

import cv2
import mediapipe as mp
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Constants ──
# MediaPipe Pose landmark indices
LEFT_HIP = 23
RIGHT_HIP = 24

# Detection thresholds
MIN_VISIBILITY = 0.5
MIN_VELOCITY_THRESHOLD = 0.003
MIN_HEIGHT_GAIN = 0.015
MIN_JUMP_SEPARATION_S = 0.5


@dataclasses.dataclass
class JumpEvent:
    """Represents a single detected jump."""
    index: int
    apex_frame: int
    apex_time: float
    takeoff_frame: int
    landing_frame: int
    confidence: float


@dataclasses.dataclass
class JumpAnalysisResult:
    """Complete analysis output."""
    session_id: str
    filename: str
    fps: float
    total_frames: int
    total_jumps: int
    jumps: List[JumpEvent]


class JumpAnalyzer:
    """Detects jumps in video using MediaPipe Pose landmarks."""

    def __init__(self):
        self.pose = mp.solutions.pose.Pose(
            static_image_mode=False,
            model_complexity=2,
            enable_segmentation=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

    def _extract_hip_y(
        self, landmarks: Any, frame_height: int
    ) -> Tuple[Optional[float], float]:
        """
        Extract mid-hip y-coordinate (average of left and right hip).
        Returns (y_pos, visibility).
        """
        left = landmarks.landmark[LEFT_HIP]
        right = landmarks.landmark[RIGHT_HIP]
        avg_visibility = (left.visibility + right.visibility) / 2.0
        avg_y = (left.y + right.y) / 2.0
        # Convert to pixel coordinates
        y_pixel = avg_y * frame_height
        return y_pixel, avg_visibility

    def detect_jumps(
        self,
        video_path: str,
        fps: float = 30.0,
        pre_trim: float = 3.0,
        post_trim: float = 3.0,
    ) -> JumpAnalysisResult:
        """
        Run MediaPipe Pose on every frame and detect jump apexes.
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        actual_fps = cap.get(cv2.CAP_PROP_FPS)
        if actual_fps > 0:
            fps = actual_fps

        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        logger.info(
            f"Video: {total_frames} frames, {fps:.2f} fps, {frame_height}px height"
        )

        # ── Extract hip y-signal over all frames ──
        hip_y_signal: List[float] = []
        visibilities: List[float] = []
        last_known_y: Optional[float] = None

        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self.pose.process(frame_rgb)

            if results.pose_landmarks:
                y_pixel, vis = self._extract_hip_y(results.pose_landmarks, frame_height)
                if vis >= MIN_VISIBILITY:
                    hip_y_signal.append(y_pixel)
                    visibilities.append(vis)
                    last_known_y = y_pixel
                else:
                    # Use last known value if available
                    if last_known_y is not None:
                        hip_y_signal.append(last_known_y)
                    else:
                        hip_y_signal.append(frame_height * 0.5)  # fallback: middle
                    visibilities.append(0.0)
            else:
                # No person detected
                if last_known_y is not None:
                    hip_y_signal.append(last_known_y)
                else:
                    hip_y_signal.append(frame_height * 0.5)
                visibilities.append(0.0)

            frame_idx += 1

            if frame_idx % 100 == 0:
                logger.debug(f"Processed {frame_idx}/{total_frames} frames")

        cap.release()
        logger.info(f"Extracted hip signal: {len(hip_y_signal)} samples")

        if len(hip_y_signal) < fps:
            logger.warning("Video too short for analysis")
            return JumpAnalysisResult(
                session_id="",
                filename=os.path.basename(video_path),
                fps=fps,
                total_frames=total_frames,
                total_jumps=0,
                jumps=[],
            )

        # ── Smooth the signal ──
        signal = np.array(hip_y_signal, dtype=np.float64)
        window_size = max(3, int(fps / 6))
        kernel = np.ones(window_size) / window_size
        smoothed = np.convolve(signal, kernel, mode='same')

        # ── Calculate velocity (first derivative) ──
        velocity = np.diff(smoothed)
        # Pad to match original length
        velocity = np.pad(velocity, (0, 1), 'edge')

        # ── Detect apexes ──
        # Apex = velocity crosses from negative to positive (hip goes up then down)
        # In image coordinates, y increases downward, so upward motion = decreasing y = negative velocity
        # Apex occurs when velocity transitions from negative to positive
        apex_frames: List[int] = []

        for i in range(1, len(velocity)):
            if velocity[i - 1] < 0 and velocity[i] >= 0:
                apex_frames.append(i)

        logger.info(f"Raw apex candidates: {len(apex_frames)}")

        # ── Filter apexes ──
        # Keep only if there's sufficient velocity dip and height gain
        min_separation_frames = int(MIN_JUMP_SEPARATION_S * fps)
        filtered_apexes: List[int] = []

        for apex in apex_frames:
            # Check velocity threshold: find minimum velocity in window before apex
            lookback = int(fps * 0.3)  # 300ms lookback
            lookahead = int(fps * 0.3)  # 300ms lookahead
            start = max(0, apex - lookback)
            end = min(len(velocity), apex + lookahead)

            min_v = np.min(velocity[start:end])
            max_v = np.max(velocity[start:end])

            if min_v >= -MIN_VELOCITY_THRESHOLD:
                continue

            # Check height gain: how much did the hip rise from lowest to apex
            search_start = max(0, apex - int(fps * 0.5))
            low_point = np.min(smoothed[search_start:apex + 1])
            height_gain = low_point - smoothed[apex]  # negative = upward movement
            if height_gain >= 0:
                height_gain = 0

            if abs(height_gain) < MIN_HEIGHT_GAIN * frame_height:
                continue

            # Check separation from previous
            if filtered_apexes and (apex - filtered_apexes[-1]) < min_separation_frames:
                # Keep the one with better velocity profile
                prev_apex = filtered_apexes[-1]
                prev_min_v = np.min(
                    velocity[
                        max(0, prev_apex - lookback) : min(len(velocity), prev_apex + lookahead)
                    ]
                )
                if abs(min_v) > abs(prev_min_v):
                    filtered_apexes[-1] = apex
                continue

            filtered_apexes.append(apex)

        logger.info(f"Filtered jumps: {len(filtered_apexes)}")

        # ── Build JumpEvent list ──
        jumps: List[JumpEvent] = []
        for idx, apex_frame in enumerate(filtered_apexes):
            # Find takeoff: last frame where velocity near zero before negative dip
            takeoff_frame = max(0, apex_frame - int(fps * 0.5))
            for j in range(apex_frame - 1, max(0, apex_frame - int(fps * 1.0)), -1):
                if j < len(velocity) - 1 and abs(velocity[j]) < MIN_VELOCITY_THRESHOLD * 0.5:
                    takeoff_frame = j
                    break

            # Find landing: first frame where velocity near zero after positive spike
            landing_frame = min(len(velocity) - 1, apex_frame + int(fps * 0.5))
            for j in range(apex_frame + 1, min(len(velocity), apex_frame + int(fps * 1.0))):
                if j < len(velocity) and abs(velocity[j]) < MIN_VELOCITY_THRESHOLD * 0.5:
                    landing_frame = j
                    break

            # Confidence: based on visibility and velocity profile
            vis_window = visibilities[
                max(0, apex_frame - int(fps * 0.3)) : min(len(visibilities), apex_frame + int(fps * 0.3))
            ]
            avg_vis = np.mean(vis_window) if vis_window else 0.0

            # Higher confidence = better visibility + stronger velocity signal
            s = max(0, apex_frame - int(fps * 0.3))
            e = min(len(velocity), apex_frame + int(fps * 0.3))
            local_min_v = np.min(velocity[s:e])
            confidence = min(1.0, avg_vis * (1.0 + min(1.0, abs(local_min_v) / 0.01)))

            apex_time = apex_frame / fps

            jump = JumpEvent(
                index=idx + 1,
                apex_frame=apex_frame,
                apex_time=apex_time,
                takeoff_frame=takeoff_frame,
                landing_frame=landing_frame,
                confidence=round(confidence, 4),
            )
            jumps.append(jump)

            logger.debug(
                f"Jump #{idx + 1}: apex={apex_frame} ({apex_time:.2f}s), "
                f"takeoff={takeoff_frame} ({takeoff_frame / fps:.2f}s), "
                f"landing={landing_frame} ({landing_frame / fps:.2f}s), "
                f"confidence={confidence:.2f}"
            )

        result = JumpAnalysisResult(
            session_id="",
            filename=os.path.basename(video_path),
            fps=fps,
            total_frames=total_frames,
            total_jumps=len(jumps),
            jumps=jumps,
        )

        return result

    def trim_clip(
        self,
        video_path: str,
        output_path: str,
        start_frame: int,
        end_frame: int,
        fps: float,
    ) -> bool:
        """
        Extract a segment from the video using OpenCV VideoWriter.
        """
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error(f"Cannot open source video: {video_path}")
            return False

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        for frame_num in range(start_frame, min(end_frame, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))):
            ret, frame = cap.read()
            if not ret:
                break
            out.write(frame)

        cap.release()
        out.release()

        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            logger.info(f"Trimmed clip saved: {output_path} ({end_frame - start_frame} frames)")
            return True
        else:
            logger.error(f"Failed to create clip: {output_path}")
            return False


# ── Convenience Functions ──

def detect_jumps(video_path: str, fps: float = 30.0, pre_trim: float = 3.0, post_trim: float = 3.0) -> JumpAnalysisResult:
    """Convenience wrapper."""
    analyzer = JumpAnalyzer()
    return analyzer.detect_jumps(video_path, fps, pre_trim, post_trim)


def trim_clip(video_path: str, output_path: str, start_frame: int, end_frame: int, fps: float) -> bool:
    """Convenience wrapper."""
    analyzer = JumpAnalyzer()
    return analyzer.trim_clip(video_path, output_path, start_frame, end_frame, fps)
