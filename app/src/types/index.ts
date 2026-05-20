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

// ── Person Detection Types ──

export interface PersonDetection {
  person_index: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  landmarks: Array<{ x: number; y: number; visibility: number }>;
}

export interface DetectPeopleResponse {
  session_id: string;
  filename: string;
  frame: string;  // base64 JPEG data URL
  frame_width: number;
  frame_height: number;
  detections: PersonDetection[];
}

export type RootStackParamList = {
  Home: undefined;
  SelectPerson: { videoUri: string };
  Processing: { videoUri: string; personIndex?: number };
  Review: { sessionId: string };
};
