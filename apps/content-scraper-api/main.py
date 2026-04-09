#!/usr/bin/env python3
"""
Content Scraper API - Scrapes shop content and derives tone of voice via LLM.
Endpoints: POST /scrape (returns job_id), GET /scrape/{job_id} (poll status/result).
"""

import os
import uuid
from typing import Any, Dict
from datetime import datetime

from fastapi import FastAPI, Header, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Content Scraper API",
    description="Scrapes shop content and derives brand tone of voice via LLM",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.getenv("API_KEY", "change-me-in-production")
JOBS: Dict[str, Dict[str, Any]] = {}


class ScrapeRequest(BaseModel):
    shop_domain: str


def run_scrape_job(job_id: str, shop_domain: str) -> None:
    """Background task: scrape content and derive tone of voice via LLM."""
    JOBS[job_id]["status"] = "running"
    try:
        # For MVP: use OpenAI to derive tone of voice from sample text
        # In production: fetch blog posts, product descriptions, about pages via Admin API
        # The Visibility app would pass access_token to call Admin API - for now we stub
        sample_content = f"""
        Brand: {shop_domain}
        [Content would be scraped from: blog posts, product descriptions, about pages]
        This is a placeholder. Configure SCRAPER_API with Shopify Admin API access
        to fetch real content. The LLM will then synthesize tone of voice.
        """
        openai_key = os.getenv("OPENAI_API_KEY")
        tone_of_voice = ""
        if openai_key:
            try:
                from openai import OpenAI  # type: ignore
                client = OpenAI(api_key=openai_key)
                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {
                            "role": "system",
                            "content": "Given brand content, synthesize the brand's tone of voice in 2-4 short paragraphs: personality, vocabulary, formality, emotional tone. Be specific and actionable for content writers.",
                        },
                        {"role": "user", "content": sample_content},
                    ],
                )
                tone_of_voice = response.choices[0].message.content or ""
            except Exception as e:
                tone_of_voice = f"[LLM error: {e}] Professional, approachable tone recommended."
        else:
            tone_of_voice = "Professional, approachable. Configure OPENAI_API_KEY for automatic derivation from scraped content."

        JOBS[job_id]["status"] = "completed"
        JOBS[job_id]["result"] = {
            "toneOfVoice": tone_of_voice,
            "scrapedFrom": ["placeholder"],
        }
    except Exception as e:
        JOBS[job_id]["status"] = "failed"
        JOBS[job_id]["error"] = str(e)


@app.get("/")
async def root():
    return {"message": "Content Scraper API", "status": "healthy"}


@app.get("/health")
async def health():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.post("/scrape")
async def scrape(
    body: ScrapeRequest,
    background_tasks: BackgroundTasks,
    x_api_key: str = Header(alias="X-API-Key", default=""),
):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    job_id = str(uuid.uuid4())
    JOBS[job_id] = {"status": "pending", "createdAt": datetime.now().isoformat()}

    background_tasks.add_task(run_scrape_job, job_id, body.shop_domain)

    return {"job_id": job_id}


@app.get("/scrape/{job_id}")
async def get_scrape_job(
    job_id: str,
    x_api_key: str = Header(alias="X-API-Key", default=""),
):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")

    return JOBS[job_id]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
