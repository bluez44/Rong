#!/usr/bin/env bash
# Chuẩn bị máy EC2 cho backend: Docker + Compose, AWS CLI, swap. Chạy bằng
# root; an toàn khi chạy lại. Hỗ trợ Amazon Linux 2023 và Ubuntu/Debian.
# deploy.sh tự gọi file này khi máy còn thiếu Docker hay AWS CLI, nên không
# bắt buộc phải dùng làm user-data.
set -euo pipefail

arch=$(uname -m) # x86_64 | aarch64

if command -v dnf >/dev/null; then
  # Amazon Linux 2023: có sẵn AWS CLI, không đóng gói compose plugin.
  dnf install -y docker unzip
  if ! docker compose version >/dev/null 2>&1; then
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${arch}" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  fi
elif command -v apt-get >/dev/null; then
  # Ubuntu/Debian: ưu tiên gói của chính distro (có ngay cả với bản Ubuntu mới
  # ra, khi Docker chưa kịp mở kho cho bản đó); không có thì dùng script chính thức.
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q curl unzip ca-certificates
  if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
    apt-get install -y -q docker.io docker-compose-v2 ||
      curl -fsSL https://get.docker.com | sh
  fi
else
  echo "Hệ điều hành chưa được hỗ trợ (cần dnf hoặc apt-get)." >&2
  exit 1
fi
systemctl enable --now docker

# AWS CLI v2: deploy.sh cần để đọc secret từ SSM Parameter Store.
if ! command -v aws >/dev/null; then
  tmp=$(mktemp -d)
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${arch}.zip" -o "$tmp/awscliv2.zip"
  unzip -q "$tmp/awscliv2.zip" -d "$tmp"
  "$tmp/aws/install" --update
  rm -rf "$tmp"
fi

# 2 GB swap: t3.micro chỉ có 1 GB RAM cho cả Node lẫn Postgres.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap defaults 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-rong.conf
sysctl --system >/dev/null

mkdir -p /opt/rong
echo "bootstrap xong: $(docker --version), $(docker compose version), $(aws --version)"
