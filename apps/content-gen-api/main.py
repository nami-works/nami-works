#!/usr/bin/env python3
"""
Content Gen API - CrewAI-based content generation for Story-telling app.
Endpoints: POST /generate (returns job_id), GET /jobs/:id (poll status/result).
"""

import os
import re
import uuid
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional
from datetime import datetime

from fastapi import FastAPI, Header, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Content Gen API",
    description="API for generating SEO content using CrewAI",
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


class BrandContext(BaseModel):
    about: Optional[str] = None
    toneOfVoice: Optional[str] = None
    brandName: Optional[str] = None
    blogUrl: Optional[str] = None
    contentLanguage: Optional[str] = "en_US"
    benchmarks: Optional[str] = None
    brandCategory: Optional[str] = None
    editorialGuidelines: Optional[str] = None
    formatRecommendations: Optional[str] = None


class GenerateRequest(BaseModel):
    shop: str
    brief: Dict[str, Any]
    brandContext: Dict[str, Any]


def sanitize_filename(filename: str) -> str:
    invalid = r'[<>:"|?*\\\/]'
    s = re.sub(invalid, "", filename).strip(" .")
    return s[:200] if s else "untitled"


def run_crew_job(job_id: str, shop: str, brief: Dict, brand_ctx: Dict) -> None:
    """Background task: run CrewAI and store result."""
    JOBS[job_id]["status"] = "running"
    try:
        import shutil
        from crew import SEOLab_CPG

        themes = brief.get("themes", {})
        seo_themes = brief.get("seo_themes", themes)
        brief_summary = brief.get("brief_summary", {})
        products_brief = brief.get("products", {})
        keywords = brief.get("keywords", {})
        macro_name = brief.get("macro_name", "campaign")
        product_context = brief.get("productContext", [])

        temp_dir = Path(tempfile.mkdtemp())
        brand_folder = temp_dir / "brand"
        posts_folder = brand_folder / "posts"
        posts_folder.mkdir(parents=True, exist_ok=True)

        products_str = "\n".join(
            f"- {p.get('handle', '')}: {p.get('title', '')}"
            for p in product_context
        ) or "No products provided"

        (posts_folder / "brief_summary.py").write_text(
            f"brief_summary = {repr(brief_summary)}",
            encoding="utf-8",
        )
        (posts_folder / "keywords.py").write_text(
            f"keywords = {repr(keywords)}",
            encoding="utf-8",
        )
        (posts_folder / "products.py").write_text(
            f"products = {repr(products_brief)}\n\nproducts_guide = '''{products_str}'''",
            encoding="utf-8",
        )

        editorials = brand_ctx.get("editorialGuidelines") or "Professional content."
        (brand_folder / "editorials.md").write_text(editorials, encoding="utf-8")

        voice = brand_ctx.get("toneOfVoice") or "Professional, approachable"
        brand_name = brand_ctx.get("brandName") or shop.split(".")[0]
        blog = brand_ctx.get("blogUrl") or ""
        benchmarks = brand_ctx.get("benchmarks") or ""
        format_recs = brand_ctx.get("formatRecommendations") or "HTML with headings"

        crew = SEOLab_CPG(brand_folder)
        inputs = {
            "voice": voice,
            "brand": brand_name,
            "blog": blog,
            "benchmarks": benchmarks,
            "format_recommendations": format_recs,
            "products": products_str,
            "semantic_fields": {},
        }
        crew.initialize_context_chunker(inputs)

        result_themes = []
        today = datetime.now().strftime("%Y-%m-%d")
        save_path = posts_folder / f"{today}_{macro_name}"
        save_path.mkdir(parents=True, exist_ok=True)

        for theme_key, theme_title in themes.items():
            summary = brief_summary.get(theme_key, "")
            kw = keywords.get(theme_key, {}) or {}
            if isinstance(kw, dict):
                pk = kw.get("primary_keywords", [])
                lt = kw.get("long_tail_keywords", [])
                rs = kw.get("related_searches", [])
            else:
                pk, lt, rs = [], [], []

            theme_inputs = {
                "voice": voice,
                "brand": brand_name,
                "name": theme_key,
                "theme": theme_title,
                "products": products_str,
                "blog": blog,
                "benchmarks": benchmarks,
                "format_recommendations": format_recs,
                "semantic_fields": {},
                "brief_summary": summary,
                "primary_keywords": pk,
                "long_tail_keywords": lt,
                "related_searches": rs,
                "search_volume": {},
                "competition_level": "medium",
                "theme_keywords_data": kw,
                "keyword_opportunities": pk[:5],
                "editorial_guidelines": editorials,
                "content_language": brand_ctx.get("contentLanguage", "en_US"),
                "preferred_language": brand_ctx.get("contentLanguage", "en_US"),
                "reference_content": brief.get("reference_content", ""),
            }

            crew_instance = crew.crew()
            crew_instance.kickoff(inputs=theme_inputs)

            # Crew writes to posts/content.html and posts/metafields.md - copy to save_path
            content_src = posts_folder / "content.html"
            mf_src = posts_folder / "metafields.md"
            safe_name = sanitize_filename(theme_key)
            html_dst = save_path / f"{safe_name}.html"
            mf_dst = save_path / f"{safe_name}_metafields.md"
            if content_src.exists():
                shutil.copy(content_src, html_dst)
            if mf_src.exists():
                shutil.copy(mf_src, mf_dst)

            html_content = html_dst.read_text(encoding="utf-8") if html_dst.exists() else f"<p>Content for {theme_title}</p>"
            meta_title = theme_title
            meta_desc = summary[:160] if summary else theme_title

            if mf_dst.exists():
                for line in mf_dst.read_text(encoding="utf-8").split("\n"):
                    if line.startswith("meta_title:"):
                        meta_title = line.replace("meta_title:", "").strip()
                    elif line.startswith("meta_description:"):
                        meta_desc = line.replace("meta_description:", "").strip()

            result_themes.append({
                "theme_key": theme_key,
                "html": html_content,
                "metafields": {"meta_title": meta_title, "meta_description": meta_desc},
            })

        shutil.rmtree(temp_dir, ignore_errors=True)

        JOBS[job_id]["status"] = "completed"
        JOBS[job_id]["result"] = {"themes": result_themes}
    except Exception as e:
        JOBS[job_id]["status"] = "failed"
        JOBS[job_id]["error"] = str(e)


@app.get("/")
async def root():
    return {"message": "Content Gen API", "status": "healthy"}


@app.get("/health")
async def health():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.post("/generate")
async def generate(
    body: GenerateRequest,
    background_tasks: BackgroundTasks,
    x_api_key: str = Header(alias="X-API-Key", default=""),
):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    job_id = str(uuid.uuid4())
    JOBS[job_id] = {"status": "pending", "createdAt": datetime.now().isoformat()}

    background_tasks.add_task(
        run_crew_job,
        job_id,
        body.shop,
        body.brief,
        body.brandContext,
    )

    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str, x_api_key: str = Header(alias="X-API-Key", default="")):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")

    return JOBS[job_id]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
