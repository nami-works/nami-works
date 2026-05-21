# Content Gen API

CrewAI-based content generation for the Story-telling app.

## Setup

1. Install dependencies: `pip install -r requirements.txt`
2. Set env vars: `API_KEY`, `OPENAI_API_KEY` (or your LLM provider)
3. Run:
   ```bash
   cd content-gen-api
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```

## Endpoints

- `POST /generate` - Start generation. Body: `{ shop, brief, brandContext }`. Returns `{ job_id }`
- `GET /jobs/{job_id}` - Poll status. Returns `{ status, result?, error? }`
- `GET /health` - Health check

## Story-telling app env

- `CONTENT_GEN_API_URL` - e.g. http://localhost:8000
- `CONTENT_GEN_API_KEY` - Must match API_KEY

## Docker

```bash
docker build -t content-gen-api .
docker run -p 8000:8000 -e API_KEY=your-key -e OPENAI_API_KEY=your-key content-gen-api
```
