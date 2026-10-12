#!/usr/bin/env bash
# Builds the game and publishes dist/ to the gh-pages branch, which GitHub Pages serves.
set -euo pipefail
cd "$(dirname "$0")/.."
npm test
npm run build
remote=$(git remote get-url origin)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -r dist/. "$tmp"
touch "$tmp/.nojekyll"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -q -m "Publish $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q -f "$remote" gh-pages
echo "Published. GitHub Pages updates within a minute or two."
