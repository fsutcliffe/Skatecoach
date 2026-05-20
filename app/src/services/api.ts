import { AnalysisResult } from '../types';

// When running on a local dev machine, use your computer's LAN IP so your iPhone can reach it.
// For production, replace with your server URL.
const API_BASE = __DEV__
  ? 'http://YOUR_COMPUTER_IP:8000'
  : 'http://localhost:8000';

/**
 * Upload a video for jump analysis.
 * Returns the AnalysisResult with session_id and list of jumps.
 */
export async function analyzeVideo(
  videoUri: string,
  preTrim: number = 3.0,
  postTrim: number = 3.0
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

export { API_BASE };
