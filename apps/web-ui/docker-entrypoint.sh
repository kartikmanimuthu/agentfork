#!/bin/sh
set -e

MAX_RETRIES=10
RETRY_DELAY=3

echo "Waiting for database connectivity..."
retries=0
while [ $retries -lt $MAX_RETRIES ]; do
    if bunx prisma@6 migrate deploy --schema=./prisma/schema.prisma 2>&1; then
        echo "Prisma migrations applied successfully."
        break
    fi

    retries=$((retries + 1))
    if [ $retries -eq $MAX_RETRIES ]; then
        echo "ERROR: Failed to apply migrations after $MAX_RETRIES attempts. Exiting."
        exit 1
    fi

    echo "Database not ready (attempt $retries/$MAX_RETRIES). Retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY
    RETRY_DELAY=$((RETRY_DELAY * 2))
done

echo "Starting Next.js server..."
exec bun run server.js
