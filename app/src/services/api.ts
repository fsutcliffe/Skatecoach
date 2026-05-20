import { AnalysisResult, DetectPeopleResponse } from '../types';

// When running on a local dev machine, use your computer's LAN IP so your iPhone can reach it.
// For production, replace with your server URL.
// Dev mode: API goes through Expo tunnel (works from iPhone on any network)
// Production: use localhost or your server URL
const TUNNEL_HOST = 'hmkdgxs-anonymous-8081.exp.direct';
const API_BASE = __DEV__
  ? `http://${TUNNEL_HOST}:80`
  : 'http://localhost:9099';

/**
 * Upload a video for jump analysis.
 * Returns the AnalysisResult with session_id and list of jumps.
 */
export async function analyzeVideo(
  videoUri: string,
  preTrim: number = 3.0,
  postTrim: number = 3.0,
  personIndex?: number
): Promise<AnalysisResult> {
  const formData = new FormData();

  // Build a file-like object from the local URI
  const filename = videoUri.split('/').pop() || 'video.mp4';
  const fileType = filename.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';

  formData.append('video', {
    uri: videoUri,
    name: filename,
    type: fileType,
  } as any);

  formData.append('pre_trim', String(preTrim));
  formData.append('post_trim', String(postTrim));

  if (personIndex !== undefined) {
    formData.append('person_index', String(personIndex));
  }

  const response = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    body: formData,
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Analysis failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Detect people in the middle frame of a video.
 * Returns bounding boxes, confidence scores, and skeleton landmarks.
 */
export async function detectPeople(videoUri: string): Promise<DetectPeopleResponse> {
  const formData = new FormData();

  const filename = videoUri.split('/').pop() || 'video.mp4';
  const fileType = filename.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';

  formData.append('video', {
    uri: videoUri,
    name: filename,
    type: fileType,
  } as any);

  const response = await fetch(`${API_BASE}/detect-people`, {
    method: 'POST',
    body: formData,
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Detection failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Build the URL for a trimmed clip.
 */
export function getClipUrl(sessionId: string, clipFilename: string): string {
  return `${API_BASE}/clips/${sessionId}/${clipFilename}`;
}

/**
 * Fetch cached analysis results for a session.
 */
export async function getResults(sessionId: string): Promise<AnalysisResult> {
  const response = await fetch(`${API_BASE}/results/${sessionId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch results (${response.status})`);
  }

  return response.json();
}

/**
 * Frame data for skeleton overlay.
 */
export interface FrameDataResponse {
  session_id: string;
  jump_index: number;
  fps: number;
  total_clip_frames: number;
  clip_start_frame: number;
  clip_end_frame: number;
  landmarks: FrameLandmarks[];  // Array per frame, each with 33 landmarks
  connections: number[][];      // Pairs of landmark indices for bones
}

/** 33 landmarks per frame */
export type FrameLandmarks = Array<{ x: number; y: number; visibility: number }>;

/**
 * Fetch per-frame landmark data for skeleton overlay rendering.
 */
export async function getFrameData(
  sessionId: string,
  jumpIndex: number
): Promise<FrameDataResponse> {
  const response = await fetch(
    `${API_BASE}/frame-data/${sessionId}/${jumpIndex}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch frame data (${response.status})`);
  }

  return response.json();
}

export { API_BASE };
