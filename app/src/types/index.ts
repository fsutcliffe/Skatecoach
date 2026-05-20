export interface JumpClip {
  jump_index: number;
  apex_time: number;
  clip_start: number;
  clip_end: number;
  duration: number;
  confidence: number;
  clip_url: string;
  clip_filename: string;
}

export interface AnalysisResult {
  session_id: string;
  filename: string;
  fps: number;
  total_frames: number;
  total_jumps: number;
  jumps: JumpClip[];
  original_video: string;
}

export type RootStackParamList = {
  Home: undefined;
  Processing: { videoUri: string };
  Review: { sessionId: string };
};
