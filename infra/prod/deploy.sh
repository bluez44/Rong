#!/usr/bin/env bash
# Deploy một image backend lên máy này. GitHub Actions gọi qua SSM Run Command
# sau khi chép docker-compose.yml, Caddyfile và file này vào /opt/rong.
#
#   deploy.sh <image>     ví dụ: deploy.sh bluez44/rong-backend:3f2a9c1…
#
# Secret lấy từ SSM Parameter Store:
#   /rong/prod/app/<TÊN_BIẾN>        → .env của backend (DB_*, JWT_SECRET, DOMAIN…)
#   /rong/prod/dockerhub/USERNAME    → đăng nhập Docker Hub để kéo image private
#   /rong/prod/dockerhub/TOKEN          (token chỉ có quyền đọc)
set -euo pipefail

IMAGE="${1:?Thiếu tên image}"
cd "$(dirname "$0")"

# Máy mới hoặc máy tạo không kèm user-data: tự cài Docker, AWS CLI, swap.
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1 || ! command -v aws >/dev/null; then
  echo "Máy chưa có Docker/Compose/AWS CLI — chạy bootstrap.sh"
  bash ./bootstrap.sh
  hash -r
fi

imds_token=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
REGION=$(curl -fsS -H "X-aws-ec2-metadata-token: ${imds_token}" \
  http://169.254.169.254/latest/meta-data/placement/region)

param() {
  aws ssm get-parameter --region "$REGION" --name "$1" --with-decryption \
    --query Parameter.Value --output text
}

# .env: mỗi dòng TÊN='giá trị' (nháy đơn để Compose không thay biến trong giá trị).
write_env() {
  local image="$1"
  aws ssm get-parameters-by-path --region "$REGION" --path /rong/prod/app \
    --with-decryption --recursive --query 'Parameters[].[Name,Value]' --output text |
    while IFS=$'\t' read -r name value; do
      # .env của Compose không có cách thoát dấu nháy đơn bên trong giá trị.
      if [[ "$value" == *"'"* ]]; then
        echo "Parameter ${name} chứa dấu nháy đơn (') — hãy đổi giá trị." >&2
        exit 1 # thoát subshell của vòng lặp; pipefail làm cả deploy dừng
      fi
      printf "%s='%s'\n" "${name##*/}" "$value"
    done > .env.new || { rm -f .env.new; return 1; }
  printf "BACKEND_IMAGE='%s'\n" "$image" >> .env.new
  chmod 600 .env.new
  mv .env.new .env
}

healthy() {
  for _ in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:3001/api/health 2>/dev/null | grep -q '"status":"ok"'; then
      return 0
    fi
    sleep 3
  done
  return 1
}

started=$(date +%s)
PREVIOUS=$(cat .deployed-image 2>/dev/null || true)
echo "Deploy ${IMAGE} (đang chạy: ${PREVIOUS:-chưa có})"

param /rong/prod/dockerhub/TOKEN |
  docker login --username "$(param /rong/prod/dockerhub/USERNAME)" --password-stdin >/dev/null

write_env "$IMAGE"
docker compose pull --quiet backend
docker compose up -d --remove-orphans

if healthy; then
  echo "$IMAGE" > .deployed-image
  docker image prune -af --filter 'until=168h' >/dev/null
  echo "Deploy thành công sau $(( $(date +%s) - started )) giây"
  exit 0
fi

echo "Health check thất bại. Log backend gần nhất:"
docker compose logs --tail 80 backend || true

if [ -n "$PREVIOUS" ]; then
  echo "Quay về ${PREVIOUS}"
  write_env "$PREVIOUS"
  docker compose up -d backend
  healthy && echo "Đã quay về bản cũ" || echo "Bản cũ cũng không lên — cần kiểm tra tay"
fi
exit 1
