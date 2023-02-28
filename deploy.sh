#!/bin/bash
# Get latest code
set -e
git stash
git checkout deploy
git merge - --no-edit
# Build latest
npm run build
# Commit the build and return
git add -A
git commit -m "Build"
git push
git checkout -