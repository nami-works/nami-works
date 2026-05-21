# Content Scraper API

Scrapes shop content and derives brand tone of voice via LLM.

## Setup

1. Install: `pip install -r requirements.txt`
2. Set env: `API_KEY`, `OPENAI_API_KEY`
3. Run: `uvicorn main:app --host 0.0.0.0 --port 8001`

## Endpoints

- `POST /scrape` - Body: `{ shop_domain }`. Returns `{ job_id }`
- `GET /scrape/{job_id}` - Poll status. Returns `{ status, result? }`

## Story-telling app env

- `SCRAPER_API_URL` - e.g. http://localhost:8001
- `SCRAPER_API_KEY` - Must match API_KEY
