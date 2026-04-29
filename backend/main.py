"""
FastAPI entry point for the Trade Exception Review Agent backend.

LEARNING: We keep main.py minimal — its only job is to wire together
the FastAPI app, CORS, and route registrations. Business logic stays
in agent/ and api/routes/.

This separation means you can test the agent graph completely independently
of the web server. A key production discipline.
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Trade Exception Review Agent",
    description="HITL agent for reviewing and resolving trade exceptions",
    version="0.1.0",
)

# LEARNING: CORS is needed because the Next.js frontend (localhost:3000)
# makes requests to this FastAPI server (localhost:8000).
# In production, lock this down to your actual frontend domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "agent": "trade-exception-review"}


# Phase 2+: Route registrations will be added here
# from backend.api.routes import stream, decision, queue
# app.include_router(stream.router)
# app.include_router(decision.router)
# app.include_router(queue.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
