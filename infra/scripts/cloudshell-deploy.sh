#!/usr/bin/env bash
# AWS CloudShell mega-script for sessions-prod deploy.
#
# Run this ONCE inside AWS CloudShell (console.aws.amazon.com →
# top-right "CloudShell" icon). Pre-installed there: aws CLI v2, psql,
# git, jq, python3. No local install needed.
#
# This script does everything AUTONOMOUSLY except for 4 pause points
# where it prints clear instructions and waits on you. Hit Enter when
# done.
#
# Required: your AWS account already has admin IAM, your terminal is
# this CloudShell window, and you have a GitHub repo for the app.
#
# Time budget: ~30 min walltime (~20 min of which is RDS + ACM waits).
#
set -euo pipefail

# ───────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

section() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  $1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

pause_for_input() {
  echo ""
  echo "╔══════════════════════════════════════════════════════════════"
  echo "║  ⏸  YOUR INPUT NEEDED"
  echo "║"
  while IFS= read -r line; do
    echo "║  $line"
  done <<< "$1"
  echo "╚══════════════════════════════════════════════════════════════"
  echo ""
  read -rp "Press Enter when ready to continue… " _
}

confirm() {
  local q="$1"
  echo ""
  read -rp "$q (y/N): " ans
  [[ "$ans" =~ ^[Yy]$ ]]
}

# ───────────────────────────────────────────────────────────────────
# Phase 0 — Inputs we need up front
# ───────────────────────────────────────────────────────────────────
section "Phase 0 / Inputs"

AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "✓ AWS account: $AWS_ACCOUNT_ID"

read -rp "AWS region [us-east-1]: " AWS_REGION
AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"

read -rp "Production domain (e.g. sessions.example.com): " DOMAIN
if [[ -z "$DOMAIN" ]]; then
  echo "✗ Domain required."
  exit 1
fi

read -rp "GitHub org/repo for the app (e.g. polecalmer/ResearchEverything-Crypto): " GH_REPO
if [[ -z "$GH_REPO" ]]; then
  echo "✗ GitHub repo required."
  exit 1
fi

echo ""
echo "Summary:"
echo "  Account:  $AWS_ACCOUNT_ID"
echo "  Region:   $AWS_REGION"
echo "  Domain:   $DOMAIN"
echo "  Repo:     $GH_REPO"
echo ""
if ! confirm "Proceed?"; then
  echo "Aborted."
  exit 0
fi

# ───────────────────────────────────────────────────────────────────
# Phase 1 — Clone the repo into CloudShell
# ───────────────────────────────────────────────────────────────────
section "Phase 1 / Clone repo into CloudShell"

WORK_DIR="$HOME/sessions-deploy"
if [[ -d "$WORK_DIR/.git" ]]; then
  echo "→ Repo already cloned, pulling latest..."
  cd "$WORK_DIR" && git pull --rebase
else
  echo "→ Cloning $GH_REPO into $WORK_DIR..."
  git clone "https://github.com/$GH_REPO.git" "$WORK_DIR"
  cd "$WORK_DIR"
fi
echo "✓ Working dir: $WORK_DIR"

# ───────────────────────────────────────────────────────────────────
# Phase 2 — Bootstrap (ECR, S3, IAM, ECS cluster, log group)
# ───────────────────────────────────────────────────────────────────
section "Phase 2 / Bootstrap base resources"

export AWS_ACCOUNT_ID AWS_REGION
bash "$WORK_DIR/infra/scripts/bootstrap.sh"

# Persist the S3 bucket name (bootstrap.sh derives it deterministically)
S3_BUCKET="sessions-prod-artifacts-${AWS_ACCOUNT_ID: -6}"
echo "S3_BUCKET=$S3_BUCKET"

# ───────────────────────────────────────────────────────────────────
# Phase 3 — GitHub Actions OIDC role
# ───────────────────────────────────────────────────────────────────
section "Phase 3 / OIDC role for GitHub Actions"

# OIDC provider for token.actions.githubusercontent.com (one per account)
if aws iam list-open-id-connect-providers \
    --query 'OpenIDConnectProviderList[?contains(Arn, `token.actions.githubusercontent.com`)] | length(@)' \
    --output text | grep -q "^[1-9]"; then
  echo "= OIDC provider already exists"
else
  echo "→ Creating OIDC provider for GitHub Actions..."
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
    > /dev/null
fi

# Trust policy that lets your specific GitHub repo assume this role.
cat > /tmp/gha-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GH_REPO}:*"
        }
      }
    }
  ]
}
EOF

GHA_ROLE_NAME="sessionsGithubActionsDeploy"
if aws iam get-role --role-name "$GHA_ROLE_NAME" >/dev/null 2>&1; then
  echo "= Role $GHA_ROLE_NAME already exists; updating trust policy..."
  aws iam update-assume-role-policy \
    --role-name "$GHA_ROLE_NAME" \
    --policy-document file:///tmp/gha-trust.json
else
  aws iam create-role \
    --role-name "$GHA_ROLE_NAME" \
    --assume-role-policy-document file:///tmp/gha-trust.json \
    > /dev/null
  echo "✓ Created role $GHA_ROLE_NAME"
fi

# Permissions: ECR push + ECS service roll
cat > /tmp/gha-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "ecs:DescribeTasks"
      ],
      "Resource": "*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name "$GHA_ROLE_NAME" \
  --policy-name "sessionsGithubActionsDeployInline" \
  --policy-document file:///tmp/gha-policy.json

rm /tmp/gha-trust.json /tmp/gha-policy.json

GHA_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${GHA_ROLE_NAME}"
echo "✓ GitHub Actions role: $GHA_ROLE_ARN"

pause_for_input "Add these THREE secrets to your GitHub repo:

  github.com/${GH_REPO}/settings/secrets/actions

  Name: AWS_ROLE_TO_ASSUME
  Value: ${GHA_ROLE_ARN}

  Name: AWS_REGION
  Value: ${AWS_REGION}

  Name: AWS_ACCOUNT_ID
  Value: ${AWS_ACCOUNT_ID}

Click 'New repository secret' three times. When all three are added,
press Enter to continue."

# ───────────────────────────────────────────────────────────────────
# Phase 4 — RDS Postgres
# ───────────────────────────────────────────────────────────────────
section "Phase 4 / RDS Postgres (10-15 min provisioning wait)"

VPC_ID="$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)"
echo "✓ Default VPC: $VPC_ID"

# Pick the first two subnets in different AZs
SUBNETS_JSON="$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'Subnets[].[SubnetId,AvailabilityZone]' --output json)"
SUBNET_A="$(echo "$SUBNETS_JSON" | jq -r '.[0][0]')"
SUBNET_B="$(echo "$SUBNETS_JSON" | jq -r 'map(select(.[1] != (.[0]|.[1]))) | .[0][0]' 2>/dev/null)"
if [[ -z "$SUBNET_B" || "$SUBNET_B" == "null" ]]; then
  SUBNET_B="$(echo "$SUBNETS_JSON" | jq -r '.[1][0]')"
fi
echo "✓ Subnets: $SUBNET_A, $SUBNET_B"

# Security groups (RDS + ECS)
make_sg() {
  local name="$1" desc="$2"
  local existing
  existing="$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$name" "Name=vpc-id,Values=$VPC_ID" \
    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null)"
  if [[ "$existing" != "None" && -n "$existing" ]]; then
    echo "$existing"
  else
    aws ec2 create-security-group --group-name "$name" --description "$desc" \
      --vpc-id "$VPC_ID" --query 'GroupId' --output text
  fi
}

RDS_SG_ID="$(make_sg sessions-rds-sg 'Sessions RDS Postgres')"
ECS_SG_ID="$(make_sg sessions-ecs-sg 'Sessions ECS tasks')"
ALB_SG_ID="$(make_sg sessions-alb-sg 'Sessions ALB')"

echo "✓ Security groups: rds=$RDS_SG_ID ecs=$ECS_SG_ID alb=$ALB_SG_ID"

# Authorize cross-SG ingress (ignore errors if already exists)
aws ec2 authorize-security-group-ingress --group-id "$RDS_SG_ID" \
  --protocol tcp --port 5432 --source-group "$ECS_SG_ID" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$ECS_SG_ID" \
  --protocol tcp --port 5000 --source-group "$ALB_SG_ID" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$ALB_SG_ID" \
  --protocol tcp --port 443 --cidr 0.0.0.0/0 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$ALB_SG_ID" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0 2>/dev/null || true

# DB subnet group
if ! aws rds describe-db-subnet-groups --db-subnet-group-name sessions-rds-subnets \
    >/dev/null 2>&1; then
  aws rds create-db-subnet-group \
    --db-subnet-group-name sessions-rds-subnets \
    --db-subnet-group-description sessions \
    --subnet-ids "$SUBNET_A" "$SUBNET_B" > /dev/null
  echo "✓ DB subnet group created"
fi

# Provision (idempotent — skip if already exists)
if aws rds describe-db-instances --db-instance-identifier sessions-prod \
    >/dev/null 2>&1; then
  echo "= RDS instance sessions-prod already exists"
  RDS_PASSWORD="$(aws secretsmanager get-secret-value \
    --secret-id sessions/prod/rds-master-password \
    --query 'SecretString' --output text 2>/dev/null || true)"
  if [[ -z "$RDS_PASSWORD" ]]; then
    pause_for_input "RDS exists but the password isn't in Secrets Manager.
If you set the password during a prior bootstrap, paste it below.
If you don't have it, run:
  aws rds modify-db-instance --db-instance-identifier sessions-prod \\
    --master-user-password '<new-password>' --apply-immediately
…and then paste the new password below."
    read -rsp "RDS master password: " RDS_PASSWORD; echo
  fi
else
  RDS_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
  echo "→ Creating RDS Postgres 16 (db.t3.small, 20 GB)..."
  aws rds create-db-instance \
    --db-instance-identifier sessions-prod \
    --engine postgres --engine-version 16 \
    --db-instance-class db.t3.small \
    --allocated-storage 20 \
    --master-username sessionsadmin \
    --master-user-password "$RDS_PASSWORD" \
    --db-subnet-group-name sessions-rds-subnets \
    --vpc-security-group-ids "$RDS_SG_ID" \
    --backup-retention-period 7 \
    --storage-encrypted \
    --no-publicly-accessible \
    > /dev/null

  # Save the password into a separate secret so we never lose it.
  aws secretsmanager create-secret \
    --name sessions/prod/rds-master-password \
    --secret-string "$RDS_PASSWORD" \
    > /dev/null
  echo "✓ Password saved to Secrets Manager: sessions/prod/rds-master-password"
fi

echo "→ Waiting for RDS to become available (~10 min)..."
aws rds wait db-instance-available --db-instance-identifier sessions-prod
echo "✓ RDS is up"

RDS_ENDPOINT="$(aws rds describe-db-instances \
  --db-instance-identifier sessions-prod \
  --query 'DBInstances[0].Endpoint.Address' --output text)"
echo "✓ Endpoint: $RDS_ENDPOINT"

# Enable pgvector — CloudShell has psql preinstalled and has an
# AWS-side IP, but we need to TEMPORARILY allow the CloudShell IP
# through the RDS SG. Get CloudShell's public IP.
echo "→ Enabling pgvector extension..."
CLOUDSHELL_IP="$(curl -s https://checkip.amazonaws.com)/32"
aws ec2 authorize-security-group-ingress \
  --group-id "$RDS_SG_ID" \
  --protocol tcp --port 5432 \
  --cidr "$CLOUDSHELL_IP" 2>/dev/null || true
aws rds modify-db-instance \
  --db-instance-identifier sessions-prod \
  --publicly-accessible --apply-immediately > /dev/null
echo "→ Waiting 90s for RDS public-access flip..."
sleep 90

PGPASSWORD="$RDS_PASSWORD" psql -h "$RDS_ENDPOINT" -U sessionsadmin -d postgres \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
echo "✓ pgvector enabled"

# Revoke + un-publicize for security
aws rds modify-db-instance \
  --db-instance-identifier sessions-prod \
  --no-publicly-accessible --apply-immediately > /dev/null
aws ec2 revoke-security-group-ingress \
  --group-id "$RDS_SG_ID" \
  --protocol tcp --port 5432 \
  --cidr "$CLOUDSHELL_IP" 2>/dev/null || true

echo ""
echo "Captured values so far:"
echo "  RDS_ENDPOINT=$RDS_ENDPOINT"
echo "  VPC_ID=$VPC_ID  SUBNET_A=$SUBNET_A  SUBNET_B=$SUBNET_B"
echo "  RDS_SG_ID=$RDS_SG_ID  ECS_SG_ID=$ECS_SG_ID  ALB_SG_ID=$ALB_SG_ID"

# ───────────────────────────────────────────────────────────────────
# Phase 5 — Production secrets
# ───────────────────────────────────────────────────────────────────
section "Phase 5 / Production secrets"

SECRETS_DIR="$HOME/.sessions-secrets"
mkdir -p "$SECRETS_DIR"
PROD_ENV_FILE="$SECRETS_DIR/prod-env.json"

# Pre-seed the file with everything we know + placeholders
cat > "$PROD_ENV_FILE" <<EOF
{
  "DATABASE_URL": "postgres://sessionsadmin:${RDS_PASSWORD}@${RDS_ENDPOINT}:5432/postgres",
  "OPENROUTER_API_KEY": "FILL_ME_IN",
  "DUNE_API_KEY": "FILL_ME_IN",
  "DEFILLAMA_PRO_API_KEY": "FILL_ME_IN",
  "COINGECKO_API_KEY": "FILL_ME_IN",
  "ALLIUM_API_KEY": "FILL_ME_IN_OR_DELETE",
  "VOYAGE_API_KEY": "FILL_ME_IN",
  "JWT_SECRET": "$(openssl rand -base64 32)",
  "PRIVY_APP_ID": "FILL_ME_IN",
  "PRIVY_APP_SECRET": "FILL_ME_IN",
  "VITE_PRIVY_APP_ID": "FILL_ME_IN",
  "ENABLE_STRIPE": "1",
  "STRIPE_SECRET_KEY": "FILL_ME_IN_LIVE_KEY",
  "STRIPE_WEBHOOK_SECRET": "FILL_ME_IN_AFTER_STEP_8",
  "PUBLIC_BASE_URL": "https://${DOMAIN}",
  "CORS_ALLOWED_ORIGINS": "https://${DOMAIN}",
  "SENTRY_DSN": "FILL_ME_IN_OR_DELETE",
  "SENTRY_TRACES_SAMPLE_RATE": "0.1",
  "NODE_ENV": "production"
}
EOF
chmod 600 "$PROD_ENV_FILE"

pause_for_input "Edit your prod env values:

  CloudShell text editor: nano ${PROD_ENV_FILE}
  (Save with Ctrl-O, Enter, Ctrl-X)

You need real values for:
  - OPENROUTER_API_KEY
  - DUNE_API_KEY
  - DEFILLAMA_PRO_API_KEY  (or delete the line if you don't have one)
  - COINGECKO_API_KEY      (free demo key at coingecko.com)
  - VOYAGE_API_KEY
  - PRIVY_APP_ID + PRIVY_APP_SECRET + VITE_PRIVY_APP_ID
    (Create a NEW Privy app for prod at privy.io — don't reuse dev)
  - STRIPE_SECRET_KEY      (sk_live_… from stripe.com dashboard)

You can SKIP for now (we'll fill in Step 8):
  - STRIPE_WEBHOOK_SECRET (creates after we know the domain is up)
  - ALLIUM_API_KEY, SENTRY_DSN if you don't use them — set to \"\" or delete

DATABASE_URL is already pre-filled with the RDS endpoint + password.
JWT_SECRET was auto-generated.

When you're done editing, press Enter."

# Validate JSON
if ! python3 -m json.tool "$PROD_ENV_FILE" > /dev/null 2>&1; then
  echo "✗ prod-env.json is not valid JSON. Fix it and re-run from this phase."
  exit 1
fi
echo "✓ JSON valid"

# Upload to Secrets Manager
if aws secretsmanager describe-secret --secret-id sessions/prod/env \
    >/dev/null 2>&1; then
  echo "→ Updating existing secret sessions/prod/env..."
  aws secretsmanager update-secret \
    --secret-id sessions/prod/env \
    --secret-string "file://$PROD_ENV_FILE" > /dev/null
else
  echo "→ Creating new secret sessions/prod/env..."
  aws secretsmanager create-secret \
    --name sessions/prod/env \
    --secret-string "file://$PROD_ENV_FILE" > /dev/null
fi

SECRETS_MANAGER_ARN="$(aws secretsmanager describe-secret \
  --secret-id sessions/prod/env --query 'ARN' --output text)"
echo "✓ Secret ARN: $SECRETS_MANAGER_ARN"

# Patch the exec role with the real secret ARN
echo "→ Patching task exec role with real secret ARN..."
sed \
  -e "s|<REGION>|$AWS_REGION|g" \
  -e "s|<ACCOUNT_ID>|$AWS_ACCOUNT_ID|g" \
  -e "s|<SECRETS_MANAGER_ARN>|$SECRETS_MANAGER_ARN|g" \
  "$WORK_DIR/infra/iam/task-execution-role-policy.json" > /tmp/exec-policy.json

aws iam put-role-policy \
  --role-name sessionsTaskExecutionRole \
  --policy-name sessionsTaskExecutionInline \
  --policy-document file:///tmp/exec-policy.json
rm /tmp/exec-policy.json
echo "✓ Exec role patched"

# Shred the local file
shred -u "$PROD_ENV_FILE" 2>/dev/null || rm -f "$PROD_ENV_FILE"
echo "✓ Local plaintext secret file removed"

# ───────────────────────────────────────────────────────────────────
# Phase 6 — Push first Docker image via GitHub Actions
# ───────────────────────────────────────────────────────────────────
section "Phase 6 / Trigger GitHub Actions build"

pause_for_input "Trigger the first build:

  1. Open: https://github.com/${GH_REPO}/actions/workflows/deploy-prod.yml
  2. Click 'Run workflow' (top right)
  3. Set 'Auto-roll the ECS service' = NO  (service doesn't exist yet)
  4. Click the green 'Run workflow' button
  5. Wait for it to finish (5-7 min). The status badge turns green.

When the workflow has completed successfully, press Enter."

# Verify image landed
LATEST_IMAGE="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/sessions:latest"
if aws ecr describe-images --repository-name sessions \
    --image-ids imageTag=latest >/dev/null 2>&1; then
  echo "✓ Image present: $LATEST_IMAGE"
else
  echo "✗ Image not found in ECR. Check the GitHub Actions log."
  exit 1
fi

# ───────────────────────────────────────────────────────────────────
# Phase 7 — Run database migrations
# ───────────────────────────────────────────────────────────────────
section "Phase 7 / Database migrations"

export ECR_REPO=sessions ECS_CLUSTER=sessions-prod
export SECRETS_MANAGER_ARN
export SUBNET_IDS="$SUBNET_A,$SUBNET_B"
export SECURITY_GROUP_ID="$ECS_SG_ID"

bash "$WORK_DIR/infra/scripts/migrate.sh"

# ───────────────────────────────────────────────────────────────────
# Phase 8 — ACM cert + ALB + listeners
# ───────────────────────────────────────────────────────────────────
section "Phase 8 / ACM cert + ALB"

# Request cert (idempotent: reuse existing for same domain)
EXISTING_CERT="$(aws acm list-certificates \
  --query "CertificateSummaryList[?DomainName=='$DOMAIN'].CertificateArn | [0]" \
  --output text 2>/dev/null)"
if [[ -n "$EXISTING_CERT" && "$EXISTING_CERT" != "None" ]]; then
  CERT_ARN="$EXISTING_CERT"
  echo "= Cert already requested: $CERT_ARN"
else
  CERT_ARN="$(aws acm request-certificate \
    --domain-name "$DOMAIN" \
    --validation-method DNS \
    --query 'CertificateArn' --output text)"
  echo "✓ Cert requested: $CERT_ARN"
fi

# Wait for the validation record to be available
echo "→ Reading DNS validation record..."
sleep 10
VAL_NAME="$(aws acm describe-certificate --certificate-arn "$CERT_ARN" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord.Name' --output text)"
VAL_VALUE="$(aws acm describe-certificate --certificate-arn "$CERT_ARN" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord.Value' --output text)"

pause_for_input "Add this CNAME at your DNS provider (Cloudflare/Route53/etc.):

  Name:  ${VAL_NAME}
  Type:  CNAME
  Value: ${VAL_VALUE}

(Strip your domain suffix from the Name field if your DNS provider
does that automatically — most do.)

ACM will detect the record automatically. Then press Enter and we'll
wait for the cert to validate (5-30 min)."

echo "→ Waiting for cert validation..."
aws acm wait certificate-validated --certificate-arn "$CERT_ARN"
echo "✓ Cert issued"

# Create ALB
if aws elbv2 describe-load-balancers --names sessions-prod >/dev/null 2>&1; then
  ALB_ARN="$(aws elbv2 describe-load-balancers --names sessions-prod \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
  echo "= ALB sessions-prod already exists"
else
  ALB_ARN="$(aws elbv2 create-load-balancer \
    --name sessions-prod \
    --subnets "$SUBNET_A" "$SUBNET_B" \
    --security-groups "$ALB_SG_ID" \
    --scheme internet-facing \
    --type application \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
  echo "✓ ALB created"
fi

ALB_DNS="$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)"

# Target group
if aws elbv2 describe-target-groups --names sessions-tg >/dev/null 2>&1; then
  TG_ARN="$(aws elbv2 describe-target-groups --names sessions-tg \
    --query 'TargetGroups[0].TargetGroupArn' --output text)"
  echo "= Target group exists"
else
  TG_ARN="$(aws elbv2 create-target-group \
    --name sessions-tg \
    --protocol HTTP --port 5000 --vpc-id "$VPC_ID" \
    --target-type ip \
    --health-check-path /health \
    --health-check-interval-seconds 30 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --query 'TargetGroups[0].TargetGroupArn' --output text)"
  echo "✓ Target group created"
fi

# Listeners (HTTPS + HTTP→HTTPS redirect)
HTTPS_LISTENER_EXISTS="$(aws elbv2 describe-listeners \
  --load-balancer-arn "$ALB_ARN" \
  --query 'Listeners[?Port==`443`] | length(@)' --output text)"
if [[ "$HTTPS_LISTENER_EXISTS" == "0" ]]; then
  aws elbv2 create-listener \
    --load-balancer-arn "$ALB_ARN" \
    --protocol HTTPS --port 443 \
    --certificates "CertificateArn=$CERT_ARN" \
    --default-actions "Type=forward,TargetGroupArn=$TG_ARN" > /dev/null
  echo "✓ HTTPS listener created"
fi

HTTP_LISTENER_EXISTS="$(aws elbv2 describe-listeners \
  --load-balancer-arn "$ALB_ARN" \
  --query 'Listeners[?Port==`80`] | length(@)' --output text)"
if [[ "$HTTP_LISTENER_EXISTS" == "0" ]]; then
  aws elbv2 create-listener \
    --load-balancer-arn "$ALB_ARN" \
    --protocol HTTP --port 80 \
    --default-actions 'Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}' > /dev/null
  echo "✓ HTTP→HTTPS redirect listener created"
fi

echo "✓ ALB DNS: $ALB_DNS"

# ───────────────────────────────────────────────────────────────────
# Phase 9 — ECS service
# ───────────────────────────────────────────────────────────────────
section "Phase 9 / ECS service"

# Register task definition
sed \
  -e "s|<ACCOUNT_ID>|$AWS_ACCOUNT_ID|g" \
  -e "s|<REGION>|$AWS_REGION|g" \
  -e "s|<S3_BUCKET>|$S3_BUCKET|g" \
  -e "s|<SECRETS_MANAGER_ARN>|$SECRETS_MANAGER_ARN|g" \
  "$WORK_DIR/infra/ecs/taskdef.json" > /tmp/taskdef.json

aws ecs register-task-definition --cli-input-json file:///tmp/taskdef.json > /dev/null
rm /tmp/taskdef.json
echo "✓ Task definition registered"

# Create the service (only if it doesn't exist)
SERVICE_EXISTS="$(aws ecs describe-services \
  --cluster sessions-prod --services app \
  --query 'services[?status==`ACTIVE`] | length(@)' --output text 2>/dev/null || echo "0")"
if [[ "$SERVICE_EXISTS" == "0" ]]; then
  aws ecs create-service \
    --cluster sessions-prod \
    --service-name app \
    --task-definition sessions \
    --desired-count 2 \
    --launch-type FARGATE \
    --load-balancers "targetGroupArn=$TG_ARN,containerName=app,containerPort=5000" \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_A,$SUBNET_B],securityGroups=[$ECS_SG_ID],assignPublicIp=ENABLED}" \
    --health-check-grace-period-seconds 60 \
    > /dev/null
  echo "✓ Service created"
else
  echo "= Service already exists; updating task definition..."
  aws ecs update-service \
    --cluster sessions-prod --service app \
    --task-definition sessions --force-new-deployment \
    > /dev/null
fi

echo "→ Waiting for service to stabilize (2-3 min)..."
aws ecs wait services-stable --cluster sessions-prod --services app
echo "✓ Service stable"

# ───────────────────────────────────────────────────────────────────
# Phase 10 — DNS cutover instructions
# ───────────────────────────────────────────────────────────────────
section "Phase 10 / DNS cutover"

pause_for_input "Point your domain at the ALB:

  At your DNS provider, create:
    Name:  ${DOMAIN}
    Type:  CNAME  (or ALIAS if Route53)
    Value: ${ALB_DNS}

Wait for propagation (1-15 min), then press Enter to run smoke tests."

# ───────────────────────────────────────────────────────────────────
# Phase 11 — Smoke tests
# ───────────────────────────────────────────────────────────────────
section "Phase 11 / Smoke tests"

echo "→ Health check..."
if curl -fsS "https://${DOMAIN}/health" | grep -q '"status"'; then
  echo "  ✓ /health → 200"
else
  echo "  ✗ /health didn't return JSON. Check ECS task logs:"
  echo "    aws logs tail /ecs/sessions-prod --follow"
fi

echo "→ CORS rejects unauthorized origin..."
if curl -fsS -H "Origin: https://evil.com" "https://${DOMAIN}/api/health" -i 2>&1 \
    | grep -qi "Access-Control-Allow-Origin: https://${DOMAIN}\|Access-Control-Allow-Origin: \*"; then
  echo "  ⚠ Access-Control-Allow-Origin header echoed for evil.com (CORS too loose)"
else
  echo "  ✓ Evil origin not echoed"
fi

echo "→ Rate limit fires..."
RL_CODES="$(for i in $(seq 1 70); do
  curl -s -o /dev/null -w '%{http_code}\n' "https://${DOMAIN}/api/health"
done | sort | uniq -c)"
echo "  HTTP code distribution over 70 reqs:"
echo "$RL_CODES" | sed 's/^/    /'

# ───────────────────────────────────────────────────────────────────
# Phase 12 — Stripe webhook + final secret update
# ───────────────────────────────────────────────────────────────────
section "Phase 12 / Stripe webhook"

pause_for_input "Final setup step — Stripe webhook:

  1. Go to https://dashboard.stripe.com/webhooks (live mode!)
  2. Click 'Add endpoint'
  3. URL:    https://${DOMAIN}/api/webhooks/stripe
  4. Events: checkout.session.completed
  5. Click 'Add endpoint' and copy the 'Signing secret' (whsec_…)

When you have the signing secret, press Enter."

read -rsp "Paste STRIPE_WEBHOOK_SECRET: " WEBHOOK_SECRET; echo

if [[ -z "$WEBHOOK_SECRET" ]]; then
  echo "✗ Empty webhook secret. Skipping update — you can update later by:"
  echo "    aws secretsmanager get-secret-value --secret-id sessions/prod/env --query SecretString --output text > /tmp/s.json"
  echo "    (edit /tmp/s.json to set STRIPE_WEBHOOK_SECRET)"
  echo "    aws secretsmanager update-secret --secret-id sessions/prod/env --secret-string file:///tmp/s.json"
  echo "    rm /tmp/s.json"
else
  CUR_SECRET="$(aws secretsmanager get-secret-value \
    --secret-id sessions/prod/env --query SecretString --output text)"
  echo "$CUR_SECRET" | jq --arg s "$WEBHOOK_SECRET" '.STRIPE_WEBHOOK_SECRET = $s' > /tmp/upd.json
  aws secretsmanager update-secret \
    --secret-id sessions/prod/env \
    --secret-string file:///tmp/upd.json > /dev/null
  rm /tmp/upd.json
  echo "✓ STRIPE_WEBHOOK_SECRET updated"

  # Force a service roll so the new env is loaded
  aws ecs update-service \
    --cluster sessions-prod --service app \
    --force-new-deployment > /dev/null
  echo "→ Rolling service to pick up the new secret..."
  aws ecs wait services-stable --cluster sessions-prod --services app
  echo "✓ Service rolled"
fi

# ───────────────────────────────────────────────────────────────────
# Done
# ───────────────────────────────────────────────────────────────────
section "✓ Deploy complete"
cat <<EOF

  Production URL:    https://${DOMAIN}
  ALB DNS:           ${ALB_DNS}
  ECS cluster:       sessions-prod
  ECS service:       app
  RDS endpoint:      ${RDS_ENDPOINT}
  S3 artifacts:      ${S3_BUCKET}
  Secrets Manager:   ${SECRETS_MANAGER_ARN}
  GHA deploy role:   ${GHA_ROLE_ARN}

Future deploys: trigger the deploy-prod workflow at
  https://github.com/${GH_REPO}/actions/workflows/deploy-prod.yml
The workflow pushes to ECR and (with auto-roll=yes) rolls the ECS service.

To roll back to a previous image revision:
  aws ecs update-service --cluster sessions-prod --service app \\
    --task-definition sessions:<previous-revision>

EOF
