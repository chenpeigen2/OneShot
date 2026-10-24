#!/bin/sh
set -e

# 首次启动：用环境变量引导超管账号
if [ -n "$PB_SUPERUSER_EMAIL" ] && [ -n "$PB_SUPERUSER_PASSWORD" ]; then
  /usr/local/bin/pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" --dir=/pb_data || true
fi

exec /usr/local/bin/pocketbase serve --http=0.0.0.0:8090 --dir=/pb_data --hooksDir=/pb_hooks
