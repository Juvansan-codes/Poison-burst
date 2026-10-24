"""
PoissonBurst Lab - FastAPI Application Entry Point.

Provides HTTP APIs for network traffic burst detection, statistical evaluation,
baseline arrival rate estimation, and synthetic simulations.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Ensure 'backend' directory is in sys.path so 'app' subpackages resolve when running from repo root or backend dir
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.api.hardware_routes import router as hardware_router
from app.services.hardware_session_manager import get_hardware_session_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: do not bind or start hardware resources
    yield
    # Shutdown: cleanly stop and release any active hardware receiver and sockets
    manager = get_hardware_session_manager()
    manager.shutdown()


app = FastAPI(
    title="PoissonBurst Lab API",
    description=(
        "Traffic burst detection in communication networks using the Poisson distribution. "
        "Built for Probability and Statistics for Computer Science (25CS203)."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Configure CORS restricted to local development origins
allowed_origins_env = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
)
allowed_origins = [origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Mount all API routes with /api prefix
app.include_router(api_router, prefix="/api")
app.include_router(hardware_router, prefix="/api/hardware")


@app.get("/", tags=["Root"])
def root_status():
    """Root endpoint redirecting or confirming API status."""
    return {
        "project": "PoissonBurst Lab",
        "status": "online",
        "documentation": "/docs",
        "api_health": "/api/health",
    }


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app.main:app", host=host, port=port, reload=True)
