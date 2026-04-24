#!/bin/bash
# Post-merge hook neutered for localhost development.
# The original ran `npx drizzle-kit push --force` which can destroy schema.
# Re-enable only in a deployment environment where pushing schema is safe.
echo "[post-merge] no-op (enable only in production deploy pipeline)"
