#!/bin/sh
# Chạy migration rồi mới khởi động app. Migration lỗi thì container thoát,
# script deploy thấy health check hỏng và quay về image cũ.
set -e

# pnpm để lệnh typeorm ở node_modules/.bin của backend (linker isolated)
# hoặc ở gốc workspace (linker hoisted): tìm ở cả hai.
PATH="$PWD/node_modules/.bin:/app/node_modules/.bin:$PATH"

echo "[entrypoint] Chạy migration…"
typeorm migration:run -d dist/database/data-source.js

echo "[entrypoint] Khởi động backend…"
exec node dist/main.js
