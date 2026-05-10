#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

ECR_REPO_NAME="chatbot-web-ui"
AWS_REGION="${AWS_REGION:-ap-south-1}"
AWS_PROFILE="${AWS_PROFILE:-PLATFORM-ADMIN}"

echo "==> Building WebUI container image..."
echo "    Region:  ${AWS_REGION}"
echo "    Profile: ${AWS_PROFILE}"

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
echo "    Account: ${ACCOUNT_ID}"

ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}"

# Create ECR repo if it doesn't exist
aws ecr describe-repositories \
    --repository-names "$ECR_REPO_NAME" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" 2>/dev/null \
  || aws ecr create-repository \
    --repository-name "$ECR_REPO_NAME" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE"

# Docker login to ECR
aws ecr get-login-password \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Build image (ARM64 for Fargate Graviton)
# Build context is PROJECT_ROOT so Dockerfile can access apps/web-ui/ and prisma/
docker build \
    -f "${PROJECT_ROOT}/apps/web-ui/Dockerfile" \
    --platform linux/arm64 \
    -t "${ECR_URI}:latest" \
    "${PROJECT_ROOT}"

# Push to ECR
docker push "${ECR_URI}:latest"

echo ""
echo "WebUI Image URI: ${ECR_URI}:latest"

# --- Workers image ---
WORKERS_ECR_REPO_NAME="chatbot-workers"
WORKERS_ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${WORKERS_ECR_REPO_NAME}"

# Create ECR repo if it doesn't exist
aws ecr describe-repositories \
    --repository-names "$WORKERS_ECR_REPO_NAME" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" 2>/dev/null \
  || aws ecr create-repository \
    --repository-name "$WORKERS_ECR_REPO_NAME" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE"

echo "==> Building Workers container image..."
docker build \
    -f "${PROJECT_ROOT}/apps/workers/Dockerfile" \
    --platform linux/arm64 \
    -t "${WORKERS_ECR_URI}:latest" \
    "${PROJECT_ROOT}"

docker push "${WORKERS_ECR_URI}:latest"

echo ""
echo "Workers Image URI: ${WORKERS_ECR_URI}:latest"
