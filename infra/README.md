# Infrastructure runbook

Executable artifacts for deploying sessions to AWS. The full
narrative is in [`docs/deploy.md`](../docs/deploy.md); this README is
the operational cheat sheet.

## Layout

```
infra/
├── iam/
│   ├── task-execution-role-trust.json    # ECS principal can assume
│   ├── task-execution-role-policy.json   # ECR + Secrets + Logs
│   ├── task-role-trust.json              # ECS principal can assume
│   └── task-role-policy.json             # S3 artifacts/* read+write
├── ecs/
│   ├── taskdef.json                      # main app container
│   └── migrate-taskdef.json              # one-off `npm run db:migrate`
└── scripts/
    ├── bootstrap.sh                      # one-shot: ECR + S3 + IAM + cluster + logs
    ├── deploy.sh                         # build + push + register + roll
    └── migrate.sh                        # run-task migrate then exit
```

## First-time setup (per environment)

```bash
# 0. Prereqs: AWS CLI configured, Docker running, repo cloned.

# 1. Set the two required envs for bootstrap:
export AWS_ACCOUNT_ID=123456789012
export AWS_REGION=us-east-1

# 2. Create ECR + S3 + IAM roles + ECS cluster + log group.
bash infra/scripts/bootstrap.sh

# 3. Manual: provision RDS Postgres 16 with pgvector.
#    See docs/deploy.md §B.3 — needs interactive password + subnet choices.
#    After it's up, grab the connection string for DATABASE_URL.

# 4. Manual: create the Secrets Manager secret with all prod env vars.
#    See docs/deploy.md §B.5 for the full list.
aws secretsmanager create-secret --name sessions/prod/env \
  --secret-string file://prod-env.json
rm prod-env.json  # do NOT commit

# 5. Patch the task-execution-role policy with the secret ARN
#    (bootstrap.sh prints the exact commands).

# 6. Export deploy-time envs:
export ECR_REPO=sessions
export ECS_CLUSTER=sessions-prod
export S3_BUCKET=sessions-prod-artifacts-XXXXXX     # bootstrap prints the actual name
export SECRETS_MANAGER_ARN=arn:aws:secretsmanager:us-east-1:...:secret:sessions/prod/env-XXXX
export SUBNET_IDS=subnet-aaa,subnet-bbb              # RDS-reachable subnets
export SECURITY_GROUP_ID=sg-xxx                      # outbound 5432 to RDS

# 7. Run migrations:
bash infra/scripts/migrate.sh

# 8. Manual: create ALB + target group + ACM cert. See docs/deploy.md §B.7-B.8.
#    Set TARGET_GROUP_ARN for the next step.

# 9. Manual: create the ECS service (only once):
aws ecs create-service \
  --cluster $ECS_CLUSTER --service-name app \
  --task-definition sessions:1 --desired-count 2 --launch-type FARGATE \
  --load-balancers targetGroupArn=$TARGET_GROUP_ARN,containerName=app,containerPort=5000 \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$SECURITY_GROUP_ID],assignPublicIp=ENABLED}" \
  --health-check-grace-period-seconds 60
export ECS_SERVICE=app

# 10. Deploy:
bash infra/scripts/deploy.sh
```

## Day-to-day deploys

```bash
# Re-export envs (or use direnv / .envrc with the same values)
export AWS_ACCOUNT_ID=...  AWS_REGION=...  ECR_REPO=...  ECS_CLUSTER=...
export ECS_SERVICE=app  S3_BUCKET=...  SECRETS_MANAGER_ARN=...

# Ship a change
bash infra/scripts/deploy.sh
```

`deploy.sh`:
1. `docker buildx build --platform linux/amd64 --push` (ECR)
2. Renders `infra/ecs/taskdef.json` with your envs, pins image to the SHA
3. `aws ecs register-task-definition` → new revision
4. `aws ecs update-service --force-new-deployment` → rolls the pool
5. `aws ecs wait services-stable` → blocks until healthy

Typical end-to-end: 4-6 min. The image pin to git SHA means rollback is just:

```bash
aws ecs update-service --cluster $ECS_CLUSTER --service $ECS_SERVICE \
  --task-definition sessions:<previous-revision>
```

## Migrations

Run `migrate.sh` as part of any deploy that includes a new migration
file under `migrations/`. The script:
- registers `infra/ecs/migrate-taskdef.json` as a new task definition
- launches a one-off Fargate task that runs `npm run db:migrate`
- streams logs to your terminal
- inspects exit code (0 = success)

Safe to run multiple times — drizzle skips already-applied migrations.

## Verifying the secret-arn role patch

After step 5 of first-time setup, confirm the exec role can read the
secret:

```bash
aws iam get-role-policy \
  --role-name sessionsTaskExecutionRole \
  --policy-name sessionsTaskExecutionInline \
  --query 'PolicyDocument.Statement[?Sid==`ReadSecrets`].Resource'
# Should print your real secret ARN, not "<SECRETS_MANAGER_ARN>".
```

If still showing the placeholder, re-run the sed + put-role-policy
commands `bootstrap.sh` printed at the end.

## What's NOT in this directory

- **Terraform** — these scripts are imperative CLI commands. Fine for
  one prod environment; reach for Terraform when you stand up
  staging/dev/etc. and want repeatability.
- **CloudWatch alarms** — set up manually via console once for the
  first month (5xx rate, task crashes, RDS CPU, daily LLM cost). See
  `docs/deploy.md §F` for the alarm specs.
- **ACM cert renewal** — AWS handles auto-renewal for DNS-validated
  certs. Nothing to script.
- **Stripe products** — `script/stripe-setup-beta-products.ts` in the
  app repo (not infra). Run with `ENABLE_STRIPE=1 STRIPE_SECRET_KEY=<live>`
  once per Stripe environment.

## Costs

| Component | Monthly |
|---|---|
| ECS Fargate 2× (1 vCPU / 2 GB) | $70 |
| RDS db.t3.small | $30 |
| ALB | $20 |
| S3 + CloudWatch + Secrets + ECR | $11 |
| Data transfer | $5 |
| **Total infrastructure** | **~$136** |

LLM spend is separate, capped per-user via cost-ceiling middleware.
