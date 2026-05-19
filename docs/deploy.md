# AWS Deploy Guide — ResearchEverything-Crypto

This guide is a checklist for getting the app from a local `npm run dev`
machine to a production AWS environment serving external traffic. It
covers secrets, storage, scaling, and the operational guardrails that
were retrofitted in May 2026 (rate limiting, cost ceiling, SSRF guard,
DOMPurify, S3 storage).

## Architecture target

```
                 Internet
                    │
                    ▼
         Application Load Balancer (ALB)
              │              │
              ▼              ▼
        ECS Fargate     ECS Fargate
         task (n=2)      task (n=2)
              │              │
              └──────┬───────┘
                     ▼
         ┌────────────────────────┐
         │ RDS Postgres (Drizzle) │
         │ Secrets Manager        │
         │ S3 (artifacts bucket)  │
         │ CloudWatch Logs        │
         └────────────────────────┘
```

- ECS Fargate (no EC2 instances to manage). 1 vCPU / 2 GB RAM per task.
- ALB terminates TLS, routes `/` and `/api/*` to the same task pool.
- RDS Postgres 16 with pgvector extension (brain + cost ledger).
- S3 bucket holds file artifacts (`STORAGE_BACKEND=s3`).
- Secrets Manager holds the env. NEVER bake `.env` into the image.
- CloudWatch captures stdout (Pino JSON logs).

## 1. Secrets Manager

Create one secret per environment:

```bash
aws secretsmanager create-secret \
  --name sessions/prod/env \
  --description "ResearchEverything-Crypto prod environment" \
  --secret-string file://prod-env.json
```

`prod-env.json` shape — every value is a string:

```json
{
  "DATABASE_URL": "postgres://...",
  "OPENROUTER_API_KEY": "sk-or-...",
  "ANTHROPIC_API_KEY": "sk-ant-...",
  // ↑ ANTHROPIC_API_KEY is optional now — all LLM calls route through
  //   OpenRouter via OPENROUTER_API_KEY. Keep it if any side-script
  //   still hits Anthropic directly; otherwise omit.
  "DUNE_API_KEY": "...",
  "ALLIUM_API_KEY": "...",
  "JWT_SECRET": "<256 random bytes base64>",
  "PRIVY_APP_ID": "...",
  "PRIVY_APP_SECRET": "...",
  "PUBLIC_BASE_URL": "https://sessions.example.com",
  "CORS_ALLOWED_ORIGINS": "https://sessions.example.com,https://www.sessions.example.com",
  "STORAGE_BACKEND": "s3",
  "S3_ARTIFACTS_BUCKET": "sessions-prod-artifacts",
  "AWS_REGION": "us-east-1",
  "RATE_LIMIT_API_PER_MIN": "60",
  "RATE_LIMIT_LLM_PER_HOUR": "30",
  "USER_DAILY_COST_CEILING_USD": "20",
  "SENTRY_DSN": "https://...@sentry.io/...",
  "NODE_ENV": "production"
}
```

In the ECS task definition, reference each value via the
`secrets:` field (it's pulled at container start and injected as env):

```json
{
  "containerDefinitions": [{
    "secrets": [
      { "name": "DATABASE_URL",      "valueFrom": "arn:aws:secretsmanager:us-east-1:<acct>:secret:sessions/prod/env:DATABASE_URL::" },
      { "name": "OPENROUTER_API_KEY","valueFrom": "arn:aws:secretsmanager:us-east-1:<acct>:secret:sessions/prod/env:OPENROUTER_API_KEY::" }
      /* ...one entry per env var... */
    ]
  }]
}
```

**Required IAM**: task execution role must have
`secretsmanager:GetSecretValue` on the secret ARN.

**Never** commit `.env` to git. Confirm `.dockerignore` excludes it.

## 2. S3 artifacts bucket

```bash
aws s3 mb s3://sessions-prod-artifacts --region us-east-1
aws s3api put-bucket-versioning --bucket sessions-prod-artifacts \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket sessions-prod-artifacts \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket sessions-prod-artifacts \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

Set `STORAGE_BACKEND=s3` + `S3_ARTIFACTS_BUCKET=sessions-prod-artifacts`
in the secret. The app auto-detects and dispatches via the S3 backend
(`server/storage-backend.ts`). Local dev keeps `STORAGE_BACKEND=local`
(or unset).

**IAM** — the task role needs read/write on the bucket prefix:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::sessions-prod-artifacts/artifacts/*"
  }]
}
```

The bucket is NEVER public. The `/api/research/artifacts/...` route
authenticates the request and proxies the bytes back from S3.

## 3. ECS task definition (high-level)

```json
{
  "family": "sessions",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "...",
  "taskRoleArn": "...",
  "containerDefinitions": [{
    "name": "app",
    "image": "<acct>.dkr.ecr.us-east-1.amazonaws.com/sessions:<tag>",
    "essential": true,
    "portMappings": [{ "containerPort": 5000, "protocol": "tcp" }],
    "secrets": [/* see §1 */],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/sessions-prod",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "app"
      }
    },
    "healthCheck": {
      "command": ["CMD-SHELL", "curl -fsS http://localhost:5000/health || exit 1"],
      "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 30
    }
  }]
}
```

## 4. ALB + service

- Target group: HTTP port 5000, healthcheck `/health`, healthy threshold 2.
- Service: 2 tasks min, 4 tasks max (autoscale on CPU > 70%).
- Connection draining: 60s (graceful shutdown handler already wired in
  `server/index.ts:221-275`).
- Idle timeout: 300s (SSE streams can run that long during deep turns).

## 5. CloudWatch alarms

- 5xx rate > 1% over 5 min → page
- p95 latency > 30s over 5 min → warn (LLM turns can be slow but
  shouldn't tail past 30s p95)
- ECS task crash count > 1 over 5 min → page
- RDS CPU > 80% over 5 min → warn
- LLM cost ledger sum > $200/day → warn (aggregate across all users)

## 6. Operational guardrails (already wired in code)

| Layer        | Defends against                               | Wired in                          |
| ------------ | --------------------------------------------- | --------------------------------- |
| SSRF guard   | AWS metadata exfil, RFC 1918 / localhost hits | `server/ssrf-guard.ts`            |
| Dune SQL     | information_schema enum, write/DDL injection  | `server/dune-mcp-client.ts`       |
| DOMPurify    | `<script>` / `on*=` in agent-emitted HTML     | `client/src/pages/report-viewer.tsx` |
| Prompt inj.  | prompt extraction / jailbreaks                | `server/prompt-injection-policy.ts` |
| Rate limit   | brute force, scraping                         | `server/index.ts` (apiLimiter, llmLimiter) |
| Cost ceiling | runaway per-user LLM spend                    | `server/cost-ceiling.ts`          |
| CORS         | cross-origin XHR exfil                        | `server/index.ts` (whitelist)     |

## 7. Tunables — env vars

| Var                            | Default | Notes                                     |
| ------------------------------ | ------- | ----------------------------------------- |
| `RATE_LIMIT_API_PER_MIN`       | 60      | per-IP, applies to `/api/*`               |
| `RATE_LIMIT_LLM_PER_HOUR`      | 30      | per-user, applies to POST messages route  |
| `USER_DAILY_COST_CEILING_USD`  | 20      | rolling 24h spend cap per user            |
| `CORS_ALLOWED_ORIGINS`         | (empty) | comma-separated origin list (REQUIRED in prod) |
| `STORAGE_BACKEND`              | `local` | `local` (disk) or `s3`                    |
| `S3_ARTIFACTS_BUCKET`          | (empty) | required when STORAGE_BACKEND=s3          |
| `AWS_REGION`                   | us-east-1 | for S3 client                           |

## 8. Pre-deploy smoke tests

After standing up infra:

```bash
# 1. Health
curl -fsS https://sessions.example.com/health
# → {"status":"ok","ts":"..."}

# 2. CORS — disallowed origin should NOT echo origin back
curl -i -H "Origin: https://evil.com" https://sessions.example.com/api/health \
  | grep -i "access-control-allow-origin"
# → header absent

# 3. SSRF — agent must refuse fetching AWS metadata
# (via authenticated session; assert response contains "SSRF block")

# 4. Rate limit
for i in {1..70}; do
  curl -s -o /dev/null -w "%{http_code}\n" https://sessions.example.com/api/health
done | tail -10
# → mix of 200 then 429

# 5. Storage backend — confirm files land in S3 not /tmp
# After a session that produced an xlsx:
aws s3 ls s3://sessions-prod-artifacts/artifacts/<sessionId>/
# → file present

# 6. Cost ceiling — temporarily set USER_DAILY_COST_CEILING_USD=0.01,
#    fire one turn, expect 429 with budget-exhausted JSON.
```

## 9. Rollback

Each ECS task definition is versioned. To roll back:

```bash
aws ecs update-service --cluster sessions-prod --service app \
  --task-definition sessions:<previous-revision>
```

ALB drains gracefully (60s); user-facing SSE streams finish their
current turn before the task dies.
