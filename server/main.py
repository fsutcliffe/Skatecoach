"""
Sideline Jump Analysis Server

FastAPI server that accepts video uploads, runs MediaPipe Pose analysis,
trims clips around each detected jump, and serves results.
"""

import logging
import os
import uuid
from typing import Dict, Optional

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from analyzer import JumpAnalysisResult, JumpEvent, detect_jumps, trim_clip

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Configuration ──
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
CLIPS_DIR = os.path.join(BASE_DIR, "clips")
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".webm", ".m4v"}

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(CLIPS_DIR, exist_ok=True)

# In-memory session storage
sessions: Dict[str, JumpAnalysisResult] = {}

# ── FastAPI App ──
app = FastAPI(
    title="Sideline Jump Analysis",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helper Functions ──

def validate_video_file(filename: str) -> bool:
    """Check if the uploaded file has an allowed video extension."""
    ext = os.path.splitext(filename.lower())[1]
    return ext in ALLOWED_EXTENSIONS


def jump_to_dict(jump: JumpEvent, session_id: str, fps: float = 30.0) -> dict:
    """Convert a JumpEvent to the API response format."""
    clip_filename = f"jump_{jump.index:03d}.mp4"
    return {
        "jump_index": jump.index,
        "apex_time": round(jump.apex_time, 3),
        "clip_start": round(jump.takeoff_frame / fps, 3),
        "clip_end": round(jump.landing_frame / fps, 3),
        "duration": round((jump.landing_frame - jump.takeoff_frame) / fps, 3),
        "confidence": jump.confidence,
        "clip_url": f"/clips/{session_id}/{clip_filename}",
        "clip_filename": clip_filename,
    }


# ── API Endpoints ──

@app.post("/analyze")
async def analyze_video(
    video: UploadFile = File(...),
    pre_trim: float = Form(3.0),
    post_trim: float = Form(3.0),
):
    """
    Upload a video for jump analysis.

    Returns analysis results including clip URLs for each detected jump.
    """
    # Validate file type
    if not validate_video_file(video.filename or "video.mp4"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Save uploaded video
    session_id = str(uuid.uuid4())
    ext = os.path.splitext(video.filename or "video.mp4")[1]
    saved_filename = f"{session_id}{ext}"
    video_path = os.path.join(UPLOAD_DIR, saved_filename)

    with open(video_path, "wb") as f:
        content = await video.read()
        f.write(content)

    logger.info(f"Saved uploaded video: {video_path} ({len(content)} bytes)")

    # Run jump detection
    try:
        result = detect_jumps(
            video_path=video_path,
            fps=30.0,
            pre_trim=pre_trim,
            post_trim=post_trim,
        )
    except Exception as e:
        logger.error(f"Analysis error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

    # Check if any jumps detected
    if result.total_jumps == 0:
        # Clean up uploaded file
        os.remove(video_path)
        return JSONResponse(
            status_code=422,
            content={
                "session_id": session_id,
                "filename": video.filename,
                "fps": result.fps,
                "total_frames": result.total_frames,
                "total_jumps": 0,
                "jumps": [],
                "original_video": saved_filename,
                "detail": "No jumps detected in video",
            },
        )

    # Trim clips for each jump
    session_clips_dir = os.path.join(CLIPS_DIR, session_id)
    os.makedirs(session_clips_dir, exist_ok=True)

    trimmed_jumps: list = []
    for jump in result.jumps:
        clip_filename = f"jump_{jump.index:03d}.mp4"
        clip_path = os.path.join(session_clips_dir, clip_filename)

        # Compute the trim window: [takeoff - pre, landing + post]
        pre_frames = int(pre_trim * result.fps)
        post_frames = int(post_trim * result.fps)
        start_frame = max(0, jump.takeoff_frame - pre_frames)
        end_frame = min(result.total_frames, jump.landing_frame + post_frames)

        success = trim_clip(
            video_path=video_path,
            output_path=clip_path,
            start_frame=start_frame,
            end_frame=end_frame,
            fps=result.fps,
        )

        if success:
            jump_dict = jump_to_dict(jump, session_id, result.fps)
            jump_dict["clip_start"] = round(start_frame / result.fps, 3)
            jump_dict["clip_end"] = round(end_frame / result.fps, 3)
            jump_dict["duration"] = round((end_frame - start_frame) / result.fps, 3)
            trimmed_jumps.append(jump_dict)
            logger.info(f"Trimmed jump #{jump.index}: frames {start_frame}-{end_frame}")
        else:
            logger.warning(f"Failed to trim clip for jump #{jump.index}")

    if not trimmed_jumps:
        raise HTTPException(status_code=500, detail="Failed to create any clip files")

    # Store results
    result.session_id = session_id
    sessions[session_id] = result

    response_data = {
        "session_id": session_id,
        "filename": video.filename,
        "fps": result.fps,
        "total_frames": result.total_frames,
        "total_jumps": len(trimmed_jumps),
        "jumps": trimmed_jumps,
        "original_video": saved_filename,
    }

    logger.info(f"Analysis complete: {len(trimmed_jumps)} jumps found (session={session_id})")
    return response_data


@app.get("/results/{session_id}")
async def get_results(session_id: str):
    """Return cached analysis results for a session."""
    result = sessions.get(session_id)
    if not result:
        raise HTTPException(status_code=404, detail="Session not found")

    clips_dir = os.path.join(CLIPS_DIR, session_id)
    jumps_data = []
    if os.path.exists(clips_dir):
        for jump in result.jumps:
            clip_filename = f"jump_{jump.index:03d}.mp4"
            clip_path = os.path.join(clips_dir, clip_filename)
            if os.path.exists(clip_path):
                jump_data = jump_to_dict(jump, session_id, result.fps)
                # Get actual clip duration from file
                import cv2
                cap = cv2.VideoCapture(clip_path)
                clip_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                clip_fps = cap.get(cv2.CAP_PROP_FPS)
                cap.release()
                if clip_fps > 0:
                    jump_data["duration"] = round(clip_frames / clip_fps, 3)
                jumps_data.append(jump_data)

    return {
        "session_id": result.session_id,
        "filename": result.filename,
        "fps": result.fps,
        "total_frames": result.total_frames,
        "total_jumps": len(jumps_data),
        "jumps": jumps_data,
        "original_video": result.filename,
    }


@app.get("/clips/{session_id}/{clip_filename}")
async def serve_clip(session_id: str, clip_filename: str):
    """Serve a trimmed jump clip."""
    clip_path = os.path.join(CLIPS_DIR, session_id, clip_filename)
    if not os.path.exists(clip_path):
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(clip_path, media_type="video/mp4")


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "sessions_active": len(sessions)}


# ── Main Entry Point ──

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
