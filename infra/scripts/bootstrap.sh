#!/usr/bin/env bash
# One-shot bootstrap for the AWS resources sessions-prod needs.
# Idempotent: each step checks if the resource exists before creating.
# Run this ONCE per environment (test, prod). Re-running is safe.
#
# What this does:
#   1. ECR repo (sessions)
#   2. S3 bucket for file artifacts (versioned, encrypted, no public access)
#   3. CloudWatch log group (/ecs/sessions-prod)
#   4. IAM role: sessionsTaskExecutionRole (ECR + secrets + logs)
#   5. IAM role: sessionsTaskRole (S3 read/write on artifacts/* only)
#   6. ECS cluster (sessions-prod)
#
# What this does NOT do (requires interactive setup):
#   - Secrets Manager secret (you provide the values via prod-env.json)
#   - RDS Postgres (needs password + subnet group decisions)
#   - ACM cert (needs DNS validation handshake with your domain)
#   - ALB + target group + security groups
#   - ECS service (see deploy.sh after bootstrap + first image push)
#
# Required env:
#   AWS_ACCOUNT_ID  AWS_REGION
#
# Optional (sensible defaults):
#   ECR_REPO              default "sessions"
#   ECS_CLUSTER           default "sessions-prod"
#   LOG_GROUP             default "/ecs/sessions-prod"
#   S3_BUCKET             default "sessions-prod-artifacts-<account-id-suffix>"
#                          (bucket names are globally unique; the suffix
#                          prevents collisions across AWS accounts)
#
# Usage:
#   bash infra/scripts/bootstrap.sh
#
set -euo pipefail

: "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID not set}"
: "${AWS_REGION:?AWS_REGION not set}"

ECR_REPO="${ECR_REPO:-sessions}"
ECS_CLUSTER="${ECS_CLUSTER:-sessions-prod}"
LOG_GROUP="${LOG_GROUP:-/ecs/sessions-prod}"
S3_BUCKET="${S3_BUCKET:-sessions-prod-artifacts-${AWS_ACCOUNT_ID: -6}}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "Bootstrap target:"
echo "  Account: $AWS_ACCOUNT_ID"
echo "  Region:  $AWS_REGION"
echo "  S3:      $S3_BUCKET"
echo ""

# ---------- 1. ECR repo ----------
echo "→ [1/6] ECR repo: $ECR_REPO"
if aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "  = already exists"
else
  aws ecr create-repository \
    --repository-name "$ECR_REPO" \
    --image-scanning-configuration scanOnPush=true \
    --region "$AWS_REGION" >/dev/null
  echo "  ✓ created"
fi

# ---------- 2. S3 bucket ----------
echo "→ [2/6] S3 bucket: $S3_BUCKET"
if aws s3api head-bucket --bucket "$S3_BUCKET" 2>/dev/null; then
  echo "  = already exists"
else
  if [[ "$AWS_REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$S3_BUCKET" --region "$AWS_REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$S3_BUCKET" --region "$AWS_REGION" \
      --create-bucket-configuration LocationConstraint="$AWS_REGION" >/dev/null
  fi
  echo "  ✓ created"
fi
aws s3api put-bucket-versioning --bucket "$S3_BUCKET" \
  --versioning-configuration Status=Enabled >/dev/null
aws s3api put-bucket-encryption --bucket "$S3_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null
aws s3api put-public-access-block --bucket "$S3_BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" >/dev/null
echo "  ✓ versioning, encryption (AES256), and public-access-block applied"

# ---------- 3. CloudWatch log group ----------
echo "→ [3/6] CloudWatch log group: $LOG_GROUP"
if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --region "$AWS_REGION" \
    --query "logGroups[?logGroupName=='$LOG_GROUP'] | length(@)" --output text | grep -q "^[1-9]"; then
  echo "  = already exists"
else
  aws logs create-log-group --log-group-name "$LOG_GROUP" --region "$AWS_REGION"
  aws logs put-retention-policy --log-group-name "$LOG_GROUP" \
    --retention-in-days 14 --region "$AWS_REGION"
  echo "  ✓ created (14-day retention)"
fi

# ---------- 4. IAM: Task Execution Role ----------
echo "→ [4/6] IAM role: sessionsTaskExecutionRole"
EXEC_ROLE_NAME="sessionsTaskExecutionRole"
if aws iam get-role --role-name "$EXEC_ROLE_NAME" >/dev/null 2>&1; then
  echo "  = already exists"
else
  aws iam create-role \
    --role-name "$EXEC_ROLE_NAME" \
    --assume-role-policy-document "file://$REPO_ROOT/infra/iam/task-execution-role-trust.json" >/dev/null
  echo "  ✓ created"
fi
# Inline policy needs the secret ARN substituted — we DON'T know it yet
# (Secrets Manager comes next, manually). Use "*" as a placeholder so
# AWS accepts the policy; the next phase (Secrets) re-runs put-role-policy
# with the real ARN once the secret exists. Wildcard is harmless for the
# 30 seconds between this bootstrap and the secret creation because no
# task runs yet.
RENDERED_EXEC_POLICY="$(mktemp)"
sed \
  -e "s|<REGION>|${AWS_REGION}|g" \
  -e "s|<ACCOUNT_ID>|${AWS_ACCOUNT_ID}|g" \
  -e "s|<SECRETS_MANAGER_ARN>|*|g" \
  "$REPO_ROOT/infra/iam/task-execution-role-policy.json" > "$RENDERED_EXEC_POLICY"
aws iam put-role-policy \
  --role-name "$EXEC_ROLE_NAME" \
  --policy-name "sessionsTaskExecutionInline" \
  --policy-document "file://$RENDERED_EXEC_POLICY" >/dev/null
rm "$RENDERED_EXEC_POLICY"
echo "  ✓ inline policy attached (NOTE: replace <SECRETS_MANAGER_ARN> after secret is created)"

# ---------- 5. IAM: Task Role ----------
echo "→ [5/6] IAM role: sessionsTaskRole"
TASK_ROLE_NAME="sessionsTaskRole"
if aws iam get-role --role-name "$TASK_ROLE_NAME" >/dev/null 2>&1; then
  echo "  = already exists"
else
  aws iam create-role \
    --role-name "$TASK_ROLE_NAME" \
    --assume-role-policy-document "file://$REPO_ROOT/infra/iam/task-role-trust.json" >/dev/null
  echo "  ✓ created"
fi
RENDERED_TASK_POLICY="$(mktemp)"
sed -e "s|<S3_BUCKET>|${S3_BUCKET}|g" \
  "$REPO_ROOT/infra/iam/task-role-policy.json" > "$RENDERED_TASK_POLICY"
aws iam put-role-policy \
  --role-name "$TASK_ROLE_NAME" \
  --policy-name "sessionsTaskRoleInline" \
  --policy-document "file://$RENDERED_TASK_POLICY" >/dev/null
rm "$RENDERED_TASK_POLICY"
echo "  ✓ inline S3 policy attached"

# ---------- 6. ECS cluster ----------
echo "→ [6/6] ECS cluster: $ECS_CLUSTER"
if aws ecs describe-clusters --clusters "$ECS_CLUSTER" --region "$AWS_REGION" \
    --query 'clusters[?status==`ACTIVE`] | length(@)' --output text | grep -q "^[1-9]"; then
  echo "  = already exists"
else
  aws ecs create-cluster --cluster-name "$ECS_CLUSTER" --region "$AWS_REGION" >/dev/null
  echo "  ✓ created"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Bootstrap complete."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps (manual, interactive):"
echo ""
echo "  1. CREATE THE PRODUCTION SECRET in Secrets Manager:"
echo "     # Put your prod values in prod-env.json (see docs/deploy.md)"
echo "     aws secretsmanager create-secret --name sessions/prod/env \\"
echo "       --secret-string file://prod-env.json --region $AWS_REGION"
echo "     rm prod-env.json"
echo ""
echo "  2. PATCH THE EXEC ROLE INLINE POLICY with the new secret ARN:"
echo "     SECRET_ARN=\$(aws secretsmanager describe-secret --secret-id sessions/prod/env \\"
echo "       --region $AWS_REGION --query ARN --output text)"
echo "     # Re-render and re-attach:"
echo "     sed -e \"s|<REGION>|$AWS_REGION|g\" -e \"s|<ACCOUNT_ID>|$AWS_ACCOUNT_ID|g\" \\"
echo "         -e \"s|<SECRETS_MANAGER_ARN>|\$SECRET_ARN|g\" \\"
echo "         infra/iam/task-execution-role-policy.json > /tmp/exec-policy.json"
echo "     aws iam put-role-policy --role-name $EXEC_ROLE_NAME \\"
echo "       --policy-name sessionsTaskExecutionInline \\"
echo "       --policy-document file:///tmp/exec-policy.json"
echo ""
echo "  3. CREATE RDS (interactive — set master password, choose subnets):"
echo "     # see docs/deploy.md §B.3"
echo ""
echo "  4. EXPORT env vars for deploy.sh / migrate.sh:"
echo "     export AWS_ACCOUNT_ID=$AWS_ACCOUNT_ID"
echo "     export AWS_REGION=$AWS_REGION"
echo "     export ECR_REPO=$ECR_REPO"
echo "     export ECS_CLUSTER=$ECS_CLUSTER"
echo "     export S3_BUCKET=$S3_BUCKET"
echo "     export SECRETS_MANAGER_ARN=\$SECRET_ARN"
echo ""
echo "  5. RUN MIGRATIONS (after RDS is up + secret is populated):"
echo "     bash infra/scripts/migrate.sh"
echo ""
echo "  6. PUSH + DEPLOY:"
echo "     bash infra/scripts/deploy.sh"
echo ""
