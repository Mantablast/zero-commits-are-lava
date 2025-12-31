# ZeroCommitsAreLava

A lightweight web game that turns your contribution calendar into a lava-running puzzle, built for low-cost AWS hosting with a static-first architecture and minimal serverless pieces.

## What you get
- Canvas-based game UI with 7-attempt simulation + replay
- GitHub + GitLab contribution fetching (no OAuth)
- DynamoDB cache to reduce upstream calls
- Share page HTML with OpenGraph tags for LinkedIn previews
- CDK stack: S3 + CloudFront (OAC) + HTTP API + Lambda + DynamoDB

## Local development

### 1) Install deps
```
npm install
npm --prefix backend install
npm --prefix frontend install
npm --prefix cdk install
```

### 2) Backend (local API)
Create `backend/.env` (or export env vars) with:
```
ALLOWED_ORIGINS=http://localhost:5173
CACHE_TTL_SECONDS=21600
FRONTEND_BASE_URL=http://localhost:5173
SHARE_OG_IMAGE=http://localhost:5173/og/zerocommitsarelava.png
```

Start the local API server:
```
npm --prefix backend run dev
```

### 3) Frontend
Create `frontend/.env` with:
```
VITE_API_BASE_URL=http://localhost:8787
VITE_SHARE_BASE_URL=http://localhost:8787
```

Start the UI:
```
npm --prefix frontend run dev
```

## Deploy (CDK)

### 1) Build frontend
```
npm --prefix frontend run build
```

### 2) Bootstrap (first time only)
```
npm --prefix cdk run bootstrap
```

### 3) Deploy
```
npm --prefix cdk run deploy
```

Outputs include:
- CloudFront URL (static site)
- API base URL (HTTP API)

### Optional CDK context knobs
```
# Cache TTL in seconds (default 21600)
cdk deploy -c cacheTtlSeconds=21600

# Override the OG image URL
cdk deploy -c shareOgImage=https://your-domain/og/zerocommitsarelava.png
```

## Low-cost checklist applied
- Static-first hosting: S3 + CloudFront (OAC, no public bucket)
- PriceClass_100, compression on, no access logs
- HTTP API + Lambda with tight memory/timeouts
- DynamoDB on-demand with TTL
- Short CloudWatch log retention
- Aggressive client caching for hashed assets

## Custom domain (later)
This stack keeps custom domains off by default to minimize cost. To add one later:
1) Create a Route53 hosted zone for your domain.
2) Request an ACM cert in `us-east-1` for CloudFront.
3) Attach the cert + domain to CloudFront and point an alias record to the distribution.

## Notes
- Replace `frontend/public/og/zerocommitsarelava.png` with a real 1200x630 image for LinkedIn previews.
- GitLab self-managed instances must expose `/users/:username/calendar.json` publicly.
- For large `weeks` values (near 52), the frontend fetches each attempt separately to stay within the max range limit.
