#!/bin/zsh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLOUDFLARED_BIN="/Users/machd/Nutcheck/bin/cloudflared"

if [ ! -x "$CLOUDFLARED_BIN" ]; then
  echo "ไม่พบ cloudflared ที่ $CLOUDFLARED_BIN"
  echo "ให้ติดตั้ง cloudflared ก่อน หรือแก้ path ใน share-cloudflare.sh"
  exit 1
fi

cd "$PROJECT_DIR"
echo "กำลังเปิดเว็บ NutCheck ให้เป็นลิงก์สาธารณะชั่วคราว..."
"$CLOUDFLARED_BIN" tunnel --url http://127.0.0.1:3000
