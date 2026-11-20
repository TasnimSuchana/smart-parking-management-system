#!/bin/sh
# Prints strong random values for the secrets in .env.example. Requires openssl.
set -eu
r() { openssl rand -hex 32; }
echo "MONGO_ROOT_PASSWORD=$(openssl rand -hex 16)"
echo "MONGO_APP_PASSWORD=$(openssl rand -hex 16)"
echo "REDIS_PASSWORD=$(openssl rand -hex 16)"
echo "RABBITMQ_PASSWORD=$(openssl rand -hex 16)"
echo "JWT_ACCESS_SECRET=$(r)"
echo "JWT_REFRESH_SECRET=$(r)"
echo "INTERNAL_API_KEY=$(r)"
echo "QR_SIGNING_SECRET=$(r)"
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
