"""
PoissonBurst Lab - FastAPI Application Entry Point.

Provides HTTP APIs for network traffic burst detection, statistical evaluation,
baseline arrival rate estimation, and synthetic simulations.
"""

from __future__ import annotations

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router

app = FastAPI(
    title="PoissonBurst Lab API",
    description=(
        "Traffic burst detection in communication networks using the Poisson distribution. "
        "Built for Probability and Statistics for Computer Science (25CS203)."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
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
