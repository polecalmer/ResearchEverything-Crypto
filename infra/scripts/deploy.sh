#!/usr/bin/env bash
# Build the Docker image, push to ECR, register a new task definition
# revision, and roll the ECS service to it. Idempotent — re-running
# with no code changes is a no-op for ECR but always rolls the service
# so secrets / task def changes take effect.
#
# Required env (set in your shell or .envrc; never commit):
#   AWS_ACCOUNT_ID         your AWS account number
#   AWS_REGION             e.g. us-east-1
#   ECR_REPO               e.g. sessions
#   ECS_CLUSTER            e.g. sessions-prod
#   ECS_SERVICE            e.g. app
#   SECRETS_MANAGER_ARN    full ARN of the prod secret
#   S3_BUCKET              e.g. sessions-prod-artifacts
#
# Optional:
#   GIT_SHA                override (defaults to current HEAD short)
#
# Usage:
#   bash infra/scripts/deploy.sh
#
set -euo pipefail

# --- guard against unset ----------------------------------------------------
for v in AWS_ACCOUNT_ID AWS_REGION ECR_REPO ECS_CLUSTER ECS_SERVICE SECRETS_MANAGER_ARN S3_BUCKET; do
  if [[ -z "${!v:-}" ]]; then
    echo "✗ $v is not set"
    exit 1
  fi
done

GIT_SHA="${GIT_SHA:-$(git rev-parse --short HEAD)}"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"
IMAGE_TAG_SHA="${ECR_URI}:${GIT_SHA}"
IMAGE_TAG_LATEST="${ECR_URI}:latest"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "→ Authenticating Docker to ECR (${AWS_REGION}, account ${AWS_ACCOUNT_ID})..."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "→ Building linux/amd64 image (Fargate is x86)..."
docker buildx build \
  --platform linux/amd64 \
  -t "$IMAGE_TAG_SHA" \
  -t "$IMAGE_TAG_LATEST" \
  --push \
  .

echo "✓ Image pushed:"
echo "    $IMAGE_TAG_SHA"
echo "    $IMAGE_TAG_LATEST"

# --- render task definition -------------------------------------------------
TASKDEF_RAW="$REPO_ROOT/infra/ecs/taskdef.json"
TASKDEF_RENDERED="$(mktemp)"

sed \
  -e "s|<ACCOUNT_ID>|${AWS_ACCOUNT_ID}|g" \
  -e "s|<REGION>|${AWS_REGION}|g" \
  -e "s|<S3_BUCKET>|${S3_BUCKET}|g" \
  -e "s|<SECRETS_MANAGER_ARN>|${SECRETS_MANAGER_ARN}|g" \
  "$TASKDEF_RAW" > "$TASKDEF_RENDERED"

# Pin the image to the SHA-tagged URL on this revision so rollback is
# trivial (point ECS at the previous task def to roll back to the
# previous SHA).
python3 -c "
import json, sys
with open('$TASKDEF_RENDERED') as f: td = json.load(f)
td['containerDefinitions'][0]['image'] = '$IMAGE_TAG_SHA'
with open('$TASKDEF_RENDERED', 'w') as f: json.dump(td, f, indent=2)
"

echo "→ Registering new task definition..."
TASKDEF_ARN=$(aws ecs register-task-definition \
  --region "$AWS_REGION" \
  --cli-input-json "file://$TASKDEF_RENDERED" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)
echo "✓ Registered: $TASKDEF_ARN"
rm "$TASKDEF_RENDERED"

echo "→ Rolling ECS service ${ECS_SERVICE}..."
aws ecs update-service \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE" \
  --task-definition "$TASKDEF_ARN" \
  --force-new-deployment \
  > /dev/null

echo "→ Waiting for service to stabilize (3-5 min)..."
aws ecs wait services-stable \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE"

echo "✓ Deploy complete."
echo ""
echo "  Image: $IMAGE_TAG_SHA"
echo "  TaskDef: $TASKDEF_ARN"
echo ""
echo "  To roll back, point the service at the prior task def revision:"
echo "    aws ecs update-service --cluster $ECS_CLUSTER --service $ECS_SERVICE \\"
echo "      --task-definition sessions:<previous-revision>"
