#!/usr/bin/env bash
# Chuẩn bị máy EC2 mới (Amazon Linux 2023) cho backend. Chạy một lần bằng
# root — dùng làm user-data khi tạo máy, hoặc chạy tay qua Session Manager.
# Amazon Linux 2023 đã có sẵn SSM Agent và AWS CLI.
set -euo pipefail

# Docker + Compose plugin (AL2023 không đóng gói compose).
dnf install -y docker
systemctl enable --now docker

arch=$(uname -m)
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${arch}" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# 2 GB swap: t3.micro chỉ có 1 GB RAM cho cả Node lẫn Postgres.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap defaults 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-rong.conf
sysctl --system >/dev/null

mkdir -p /opt/rong
echo "bootstrap xong: $(docker --version), $(docker compose version)"
