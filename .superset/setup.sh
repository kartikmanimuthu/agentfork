#!/bin/bash

# chmod +x ./.superset/setup.sh
# .superset/setup.sh

set -e

# Use the Superset-provided variable for the main repository
MAIN_DIR="$SUPERSET_ROOT_PATH"
TARGET_DIR="$PWD"

echo "Copying environment files from $MAIN_DIR to $TARGET_DIR..."

# Move to main dir to find the files
cd "$MAIN_DIR"

# Find .env files and replicate them in the worktree
find . -name ".env*" -type f \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  -not -path "*/.claude/*" \
  -not -path "*/.superset/*" \
  -not -path "*/.next/*" \
  -not -path "*/cdk.out/*" \
  -not -path "*/playwright-report/*" \
  -print0 | while IFS= read -r -d $'\0' env_file; do
    
    # Remove leading './' 
    rel_path="${env_file#./}"
    dest_path="$TARGET_DIR/$rel_path"
    
    # Create parent directory in the workspace and copy the file
    mkdir -p "$(dirname "$dest_path")"
    cp "$MAIN_DIR/$rel_path" "$dest_path"
    
    echo "✅ Replicated: $rel_path"
done

echo "Environment files successfully replicated!"