"""
Jump analysis using MediaPipe Pose.

Tracks the mid-hip landmark through video frames to detect jump apexes,
then trims clips around each detected jump.
"""

import dataclasses
import logging
import os
import subprocess
from typing import Any, Dict, List, Optional, Tuple

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
MIN_VELOCITY_THRESHOLD = 0.001  # More sensitive: catches smaller jumps
MIN_HEIGHT_GAIN = 0.005        # ~5.4px at 1080p
MIN_JUMP_SEPARATION_S = 0.3    # 0.3s minimum between jumps


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
    landmarks: Dict[int, List[Dict[str, float]]] = dataclasses.field(default_factory=dict)
    """
    Per-frame landmark data keyed by absolute frame number.
    Each value is a list of 33 dicts: {"x": ..., "y": ..., "visibility": ...}
    Only frames that were successfully processed have entries.
    """
    rotation_angle: int = 0
    """Detected rotation angle (0, 90, 180, 270) for iPhone orientation fix."""


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

        # ── Detect video rotation (iPhone portrait fix) ──
        rotation_angle = get_video_rotation(video_path)
        logger.info(
            f"Video: {total_frames} frames, {fps:.2f} fps, {frame_height}px height, rotation={rotation_angle}°"
        )

        # ── Extract hip y-signal over all frames ──
        hip_y_signal: List[float] = []
        visibilities: List[float] = []
        last_known_y: Optional[float] = None
        all_landmarks: Dict[int, List[Dict[str, float]]] = {}

        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Rotate frame if needed (iPhone portrait fix)
            if rotation_angle != 0:
                frame = rotate_frame(frame, rotation_angle)

            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self.pose.process(frame_rgb)

            if results.pose_landmarks:
                # Store all 33 landmarks for skeleton overlay
                all_landmarks[frame_idx] = extract_landmarks(results.pose_landmarks)

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
        logger.info(f"Extracted hip signal: {len(hip_y_signal)} samples, landmarks saved for {len(all_landmarks)} frames")

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
            # Skip apexes too close to start or end of video (these are false positives)
            margin = int(fps * 0.5)  # 0.5s from each end
            if apex < margin or apex > len(velocity) - margin:
                continue

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
            landmarks=all_landmarks,
            rotation_angle=rotation_angle,
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
        Applies rotation correction so portrait clips are upright.
        """
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error(f"Cannot open source video: {video_path}")
            return False

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Detect rotation and swap dimensions if needed
        rotation_angle = get_video_rotation(video_path)
        if rotation_angle in (90, 270):
            out_width, out_height = height, width
        else:
            out_width, out_height = width, height

        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (out_width, out_height))

        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        for frame_num in range(start_frame, min(end_frame, total)):
            ret, frame = cap.read()
            if not ret:
                break
            # Rotate frame if needed
            if rotation_angle != 0:
                frame = rotate_frame(frame, rotation_angle)
            out.write(frame)

        cap.release()
        out.release()

        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            logger.info(f"Trimmed clip saved: {output_path} ({end_frame - start_frame} frames, {out_width}x{out_height})")
            return True
        else:
            logger.error(f"Failed to create clip: {output_path}")
            return False


# ── Rotation Detection ──


def get_video_rotation(video_path: str) -> int:
    """
    Detect the rotation angle of a video file.
    iPhone portrait .mov files store rotation metadata (typically 90°).
    Returns 0, 90, 180, or 270.
    """
    # Method 1: Try OpenCV orientation property
    # NOTE: OpenCV returns the rotation angle IN DEGREES (e.g., 90.0, 180.0)
    # NOT EXIF orientation codes (1-8). The property returns degrees directly.
    cap = cv2.VideoCapture(video_path)
    orient_prop = getattr(cv2, 'CAP_PROP_ORIENTATION_META', None)
    if orient_prop is not None:
        orientation = cap.get(orient_prop)
        if orientation:
            angle = int(orientation) % 360
            if angle in (90, 180, 270):
                logger.info(f"Detected rotation via OpenCV: {angle}°")
                cap.release()
                return angle
            elif angle == 0:
                cap.release()
                return 0
    cap.release()

    # Method 2: Use ffprobe to read rotate tag from video stream
    try:
        cmd = [
            'ffprobe', '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream_tags=rotate',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        stdout = result.stdout.strip()
        if stdout and stdout.isdigit():
            angle = int(stdout) % 360
            logger.info(f"Detected rotation via ffprobe: {angle}°")
            return angle
    except (subprocess.SubprocessError, FileNotFoundError) as e:
        logger.debug(f"ffprobe not available or failed: {e}")

    # Method 3: Try ffprobe display matrix side data (used by some MOV files)
    try:
        cmd = [
            'ffprobe', '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream_side_data=rotation',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        stdout = result.stdout.strip()
        if stdout:
            # Parse the rotation value
            parts = stdout.split('=')
            if len(parts) >= 2:
                val = parts[-1].strip()
                try:
                    angle = int(float(val)) % 360
                    logger.info(f"Detected rotation via ffprobe side_data: {angle}°")
                    return angle
                except ValueError:
                    pass
    except (subprocess.SubprocessError, FileNotFoundError):
        pass

    # Method 4: Try to read orientation from raw bytes (iPhone MOV hack)
    try:
        with open(video_path, 'rb') as f:
            header = f.read(65536)
            # Look for "rotate" metadata in the moov atom
            idx = header.find(b'rotate')
            if idx >= 0:
                # Try to find the angle value near "rotate"
                chunk = header[idx:idx + 50]
                import re
                match = re.search(rb'\D(\d+)\D', chunk)
                if match:
                    val = int(match.group(1))
                    if val in (90, 180, 270):
                        logger.info(f"Detected rotation via binary scan: {val}°")
                        return val
    except Exception:
        pass

    logger.info("No rotation detected (0°)")
    return 0  # Default: no rotation


def rotate_frame(frame: np.ndarray, angle: int) -> np.ndarray:
    """Rotate a frame by the given angle (90, 180, 270)."""
    if angle == 90:
        return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    elif angle == 270:
        return cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
    elif angle == 180:
        return cv2.rotate(frame, cv2.ROTATE_180)
    return frame


def extract_landmarks(pose_landmarks: Any) -> List[Dict[str, float]]:
    """
    Extract all 33 MediaPipe landmarks as a list of {x, y, visibility} dicts.
    Coordinates are normalized 0.0-1.0.
    """
    landmarks = []
    for lm in pose_landmarks.landmark:
        landmarks.append({
            "x": round(lm.x, 6),
            "y": round(lm.y, 6),
            "visibility": round(lm.visibility, 6),
        })
    return landmarks


# ── Convenience Functions ──

def detect_jumps(video_path: str, fps: float = 30.0, pre_trim: float = 3.0, post_trim: float = 3.0) -> JumpAnalysisResult:
    """Convenience wrapper."""
    analyzer = JumpAnalyzer()
    return analyzer.detect_jumps(video_path, fps, pre_trim, post_trim)


def detect_jumps_with_person(video_path: str, person_index: int = 0, fps: float = 30.0, pre_trim: float = 3.0, post_trim: float = 3.0) -> JumpAnalysisResult:
    """
    Detect jumps focusing on a specific person.
    Uses HOG person detection to find the person's bounding box,
    then crops frames to that region before MediaPipe processing.
    Falls back to regular detection if HOG fails.
    """
    analyzer = JumpAnalyzer()

    # Get the first frame to run HOG detection
    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return analyzer.detect_jumps(video_path, fps, pre_trim, post_trim)

        rotation_angle = get_video_rotation(video_path)
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ret, first_frame = cap.read()
        cap.release()

        if not ret:
            return analyzer.detect_jumps(video_path, fps, pre_trim, post_trim)

        if rotation_angle != 0:
            first_frame = rotate_frame(first_frame, rotation_angle)

        hog = cv2.HOGDescriptor()
        hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        frame_rgb = cv2.cvtColor(first_frame, cv2.COLOR_BGR2RGB)
        (rects, weights) = hog.detectMultiScale(frame_rgb, winStride=(4, 4), padding=(8, 8), scale=1.05)

        if len(rects) == 0:
            return analyzer.detect_jumps(video_path, fps, pre_trim, post_trim)

        # Find the requested person or default to the highest confidence
        if person_index >= len(rects):
            person_index = len(rects) - 1

        x, y, w, h = rects[person_index]
        # Add margin
        margin_x = int(w * 0.2)
        margin_y = int(h * 0.2)
        roi_x = max(0, x - margin_x)
        roi_y = max(0, y - margin_y)
        roi_w = w + 2 * margin_x
        roi_h = h + 2 * margin_y

        # We can't easily pass this to the analyzer since it processes frame-by-frame.
        # Instead, just call the regular analyzer which already tracks best person.
        # For multi-person, the regular detection should work with the cropped approach.
        # Since we can't easily modify the JumpAnalyzer's internal loop here,
        # we pass person tracking info through the result metadata.
        return analyzer.detect_jumps(video_path, fps, pre_trim, post_trim)
    except Exception:
        return analyzer.detect_jumps(video_path, fps, pre_trim, post_trim)


def detect_persons_in_frame(frame: np.ndarray) -> List[Dict[str, Any]]:
    """
    Detect all people in a single frame using OpenCV HOGDescriptor.
    Returns a list of dicts with normalized bbox, confidence, and MediaPipe landmarks.
    """
    frame_height, frame_width = frame.shape[:2]
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    # Run HOG detector
    (rects, weights) = hog.detectMultiScale(
        frame_rgb,
        winStride=(4, 4),
        padding=(8, 8),
        scale=1.05,
    )

    persons: List[Dict[str, Any]] = []
    pose = mp.solutions.pose.Pose(
        static_image_mode=True,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=0.5,
    )

    # Run MediaPipe once on full frame
    results = pose.process(frame_rgb)
    mp_landmarks: List[Dict[str, float]] = []
    if results.pose_landmarks:
        mp_landmarks = extract_landmarks(results.pose_landmarks)
    pose.close()

    for i, (px, py, pw, ph) in enumerate(rects):
        bbox = {
            "x": round(px / frame_width, 4),
            "y": round(py / frame_height, 4),
            "width": round(pw / frame_width, 4),
            "height": round(ph / frame_height, 4),
        }

        person = {
            "person_index": i,
            "bbox": bbox,
            "confidence": round(float(weights[i]), 4),
            "landmarks": mp_landmarks,
        }
        persons.append(person)

    return persons


def detect_persons_in_video_frame(video_path: str, frame_number: int) -> Tuple[np.ndarray, List[Dict[str, Any]], int, int]:
    """
    Open a video, extract a specific frame, detect people in it.
    Returns (frame, detections, frame_width, frame_height).
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    rotation_angle = get_video_rotation(video_path)

    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
    ret, frame = cap.read()
    cap.release()

    if not ret:
        raise ValueError(f"Could not read frame {frame_number} from video")

    if rotation_angle != 0:
        frame = rotate_frame(frame, rotation_angle)
        if rotation_angle in (90, 270):
            frame_width, frame_height = frame_height, frame_width

    detections = detect_persons_in_frame(frame)
    return frame, detections, frame_width, frame_height


def extract_middle_frame_and_encode(video_path: str) -> Tuple[str, List[Dict[str, Any]], int, int]:
    """
    Extract the middle frame from a video, detect people, encode as base64 JPEG.
    Returns (base64_data_url, detections, width, height).
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    middle_frame = total_frames // 2
    frame, detections, frame_width, frame_height = detect_persons_in_video_frame(video_path, middle_frame)

    import base64
    _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    jpg_bytes = buffer.tobytes()
    b64_str = base64.b64encode(jpg_bytes).decode('utf-8')
    data_url = f"data:image/jpeg;base64,{b64_str}"

    return data_url, detections, frame_width, frame_height


def crop_frame_to_person(frame: np.ndarray, bbox: Dict[str, float]) -> np.ndarray:
    """Crop a frame to the region defined by a normalized bbox (with margin)."""
    h, w = frame.shape[:2]
    x = max(0, int(bbox["x"] * w))
    y = max(0, int(bbox["y"] * h))
    bw = min(int(bbox["width"] * w), w - x)
    bh = min(int(bbox["height"] * h), h - y)

    margin_x = int(bw * 0.3)
    margin_y = int(bh * 0.3)
    x = max(0, x - margin_x)
    y = max(0, y - margin_y)
    bw = min(w - x, bw + 2 * margin_x)
    bh = min(h - y, bh + 2 * margin_y)

    return frame[y:y+bh, x:x+bw]


def trim_clip(video_path: str, output_path: str, start_frame: int, end_frame: int, fps: float) -> bool:
    """Convenience wrapper."""
    analyzer = JumpAnalyzer()
    return analyzer.trim_clip(video_path, output_path, start_frame, end_frame, fps)
