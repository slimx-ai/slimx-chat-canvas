"""Compatibility entrypoint for uvicorn.

Run with:
    uvicorn server:app --host 0.0.0.0 --port 8080
"""

from app.main import app
