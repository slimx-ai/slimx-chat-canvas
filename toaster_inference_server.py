"""Standalone-compatible entrypoint for the Toaster inference server.

This now reuses the organized FastAPI app in app.main. It still exposes /api/chat,
/api/chat/stream, /generate, /health, and the static UI.
"""

from app.main import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("toaster_inference_server:app", host="0.0.0.0", port=8080, reload=False)
