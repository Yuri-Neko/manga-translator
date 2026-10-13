#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CF_DIR="$ROOT/.cloudflare"
CONFIG="$CF_DIR/config.yml"
ENV_FILE="$ROOT/.env"
TUNNEL_NAME="manga-translator"

if [[ $EUID -ne 0 ]]; then
  echo "Jalankan sebagai root: sudo bash scripts/setup-cloudflare.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker belum terpasang. Instal Docker Engine dan Compose plugin terlebih dahulu."
  echo "Panduan: https://docs.docker.com/engine/install/ubuntu/"
  exit 1
fi
docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose plugin belum tersedia. Instal docker-compose-plugin terlebih dahulu."
  exit 1
}

if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.example "$ENV_FILE"
  echo "File .env dibuat. Isi POSTGRES_PASSWORD terlebih dahulu, lalu jalankan script ini lagi."
  exit 1
fi
if grep -Eq '^POSTGRES_PASSWORD=change-this-to-a-long-random-password$|^POSTGRES_PASSWORD=$' "$ENV_FILE"; then
  echo "Ubah POSTGRES_PASSWORD di .env menjadi password kuat sebelum melanjutkan."
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Menginstal cloudflared dari repository resmi Cloudflare..."
  apt-get update
  apt-get install -y ca-certificates curl
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(. /etc/os-release && echo "$VERSION_CODENAME") main" > /etc/apt/sources.list.d/cloudflared.list
  apt-get update
  apt-get install -y cloudflared
fi

mkdir -p "$CF_DIR"
chmod 700 "$CF_DIR"

echo
echo "=== LOGIN CLOUDFLARE (WAJIB SEBELUM DOCKER) ==="
echo "Buka URL login yang ditampilkan cloudflared, lalu pilih akun dan domain yang benar."
cloudflared tunnel login

read -rp "Hostname publik untuk Manga Translator (contoh: manga.example.com): " HOSTNAME
HOSTNAME="${HOSTNAME,,}"
if [[ ! "$HOSTNAME" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || [[ "$HOSTNAME" != *.* ]]; then
  echo "Hostname tidak valid."
  exit 1
fi

if [[ -f "$CONFIG" ]]; then
  echo "Konfigurasi $CONFIG sudah ada; tidak akan ditimpa otomatis."
  read -rp "Timpa konfigurasi project ini? Ketik YES untuk lanjut: " CONFIRM
  [[ "$CONFIRM" == "YES" ]] || { echo "Dibatalkan, Docker belum dijalankan."; exit 1; }
fi

if cloudflared tunnel list 2>/dev/null | awk 'NR>1 {print $2}' | grep -Fxq "$TUNNEL_NAME"; then
  echo "Tunnel '$TUNNEL_NAME' sudah ada di akun Cloudflare."
else
  cloudflared tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID="$(cloudflared tunnel list --output json | python3 -c 'import json,sys; name=sys.argv[1]; rows=json.load(sys.stdin); print(next((x["id"] for x in rows if x.get("name")==name), ""))' "$TUNNEL_NAME")"
if [[ -z "$TUNNEL_ID" ]]; then
  echo "Gagal menemukan ID tunnel '$TUNNEL_NAME'. Docker belum dijalankan."
  exit 1
fi
CREDENTIALS="$HOME/.cloudflared/$TUNNEL_ID.json"
if [[ ! -f "$CREDENTIALS" ]]; then
  echo "File kredensial tunnel tidak ditemukan: $CREDENTIALS"
  echo "Pastikan login berhasil dan tunnel dibuat oleh akun ini. Docker belum dijalankan."
  exit 1
fi

install -m 600 "$CREDENTIALS" "$CF_DIR/$TUNNEL_ID.json"
cat > "$CONFIG" <<EOF
tunnel: $TUNNEL_ID
credentials-file: /etc/cloudflared/$TUNNEL_ID.json
no-autoupdate: true

ingress:
  - hostname: $HOSTNAME
    service: http://web:80
  - service: http_status:404
EOF
chmod 600 "$CONFIG"

cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME"

echo
echo "Cloudflare Tunnel siap: https://$HOSTNAME"
echo "Baru sekarang Docker akan dibangun dan dijalankan."
docker compose up -d --build
docker compose ps
echo
echo "Selesai. Log tunnel: docker compose logs -f cloudflared"
