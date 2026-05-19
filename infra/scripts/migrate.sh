#!/usr/bin/env bash
# Run database migrations as a one-off ECS Fargate task.
# Fires `npm run db:migrate` inside a fresh container that uses the
# same image + secrets as the production task, but exits after the
# migration completes. Safe to run before deploy (it doesn't touch
# the running service) and idempotent (drizzle-orm skips applied
# migrations).
#
# Required env (same as deploy.sh):
#   AWS_ACCOUNT_ID  AWS_REGION  ECR_REPO
#   ECS_CLUSTER     (must already exist)
#   SECRETS_MANAGER_ARN
#   SUBNET_IDS      comma-separated subnet IDs in the RDS-reachable VPC
#                   e.g. "subnet-abc,subnet-def"
#   SECURITY_GROUP_ID
#                   security group that allows outbound 5432 to RDS
#
# Usage:
#   bash infra/scripts/migrate.sh
#
set -euo pipefail

for v in AWS_ACCOUNT_ID AWS_REGION ECR_REPO ECS_CLUSTER SECRETS_MANAGER_ARN SUBNET_IDS SECURITY_GROUP_ID; do
  if [[ -z "${!v:-}" ]]; then
    echo "✗ $v is not set"
    exit 1
  fi
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Render the migrate task definition.
TASKDEF_RAW="$REPO_ROOT/infra/ecs/migrate-taskdef.json"
TASKDEF_RENDERED="$(mktemp)"
sed \
  -e "s|<ACCOUNT_ID>|${AWS_ACCOUNT_ID}|g" \
  -e "s|<REGION>|${AWS_REGION}|g" \
  -e "s|<SECRETS_MANAGER_ARN>|${SECRETS_MANAGER_ARN}|g" \
  "$TASKDEF_RAW" > "$TASKDEF_RENDERED"

echo "→ Registering migrate task definition..."
TASKDEF_ARN=$(aws ecs register-task-definition \
  --region "$AWS_REGION" \
  --cli-input-json "file://$TASKDEF_RENDERED" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)
rm "$TASKDEF_RENDERED"

echo "→ Launching migrate task..."
TASK_ARN=$(aws ecs run-task \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --task-definition "$TASKDEF_ARN" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_IDS}],securityGroups=[${SECURITY_GROUP_ID}],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' \
  --output text)
TASK_ID="${TASK_ARN##*/}"
echo "  Task ID: $TASK_ID"
echo ""
echo "→ Streaming logs (Ctrl-C to detach; task continues running)..."

# Wait briefly for the task to start, then tail logs.
sleep 10
aws logs tail "/ecs/sessions-prod" \
  --region "$AWS_REGION" \
  --log-stream-name-prefix "migrate/migrate/$TASK_ID" \
  --follow &
LOG_PID=$!

# Wait for the task to finish.
aws ecs wait tasks-stopped \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --tasks "$TASK_ARN"

# Stop log tail.
kill $LOG_PID 2>/dev/null || true

# Inspect the exit code.
EXIT_CODE=$(aws ecs describe-tasks \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' \
  --output text)

echo ""
if [[ "$EXIT_CODE" == "0" ]]; then
  echo "✓ Migrations applied successfully."
else
  echo "✗ Migration task exited with code $EXIT_CODE."
  echo "  Inspect logs: aws logs tail /ecs/sessions-prod --region $AWS_REGION --log-stream-name-prefix migrate/migrate/$TASK_ID"
  exit 1
fi
