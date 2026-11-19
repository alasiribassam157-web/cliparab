#!/usr/bin/env bash
# Downloads Tajawal (SIL Open Font License) for burned-in Arabic captions. Run once on a machine with internet.
set -euo pipefail
dest="${1:-assets/fonts}"
mkdir -p "$dest"
for w in Regular Medium Bold ExtraBold; do
  curl -fsSL -o "$dest/Tajawal-$w.ttf" "https://github.com/google/fonts/raw/main/ofl/tajawal/Tajawal-$w.ttf" && echo "ok $w" || echo "skip $w"
done
