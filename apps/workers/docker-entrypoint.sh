#!/bin/sh
set -e

echo "Running database migrations..."
bunx prisma migrate deploy --schema=./prisma/schema.prisma

echo "Migrations complete. Starting process..."
exec "$@"
