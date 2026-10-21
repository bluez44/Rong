#!/usr/bin/env bash
# Đính kèm một file vào GitHub Release của tag, tạo release nếu chưa có.
# Workflow APK và iOS chạy song song trên cùng một tag: bên nào tới trước tạo release, bên sau chỉ upload.
#   upload-release-asset.sh <tag> <file>   (cần GH_TOKEN)
set -euo pipefail

tag="$1"
file="$2"

if ! gh release view "$tag" >/dev/null 2>&1; then
  # Thua cuộc đua tạo release (workflow kia vừa tạo xong) thì bỏ qua lỗi, upload bên dưới vẫn chạy.
  gh release create "$tag" --verify-tag --generate-notes --title "$tag" ||
    gh release view "$tag" >/dev/null
fi

gh release upload "$tag" "$file" --clobber
