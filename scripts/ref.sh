#!/bin/sh
# Clone or refresh read-only upstream references into .ref/ (gitignored, shallow).
# Target: Thunderbird 157 (Release). Override with TB_TAG / DOCS_BRANCH.
set -eu

TB_TAG="${TB_TAG:-THUNDERBIRD_157_0_RELEASE}"
DOCS_BRANCH="${DOCS_BRANCH:-release-mv3}"
REF="$(cd "$(dirname "$0")/.." && pwd)/.ref"
mkdir -p "$REF"

# clone_or_update <dir> <url> <ref>
clone_or_update() {
  dir="$REF/$1"
  if [ -d "$dir/.git" ]; then
    echo "update $1 ($3)"
    git -C "$dir" fetch --quiet --depth 1 origin "$3"
    git -C "$dir" checkout --quiet --force FETCH_HEAD
  else
    echo "clone $1 ($3)"
    git clone --quiet --depth 1 --branch "$3" "$2" "$dir"
  fi
}

# Thunderbird desktop source at the targeted release (sparse: themes + extension schemas).
# Kept at .ref/comm-central so paths in docs and skills stay stable.
tb="$REF/comm-central"
if [ -d "$tb/.git" ]; then
  echo "update comm-central ($TB_TAG)"
  git -C "$tb" fetch --quiet --depth 1 --filter=blob:none origin "refs/tags/$TB_TAG:refs/tags/$TB_TAG"
  git -C "$tb" checkout --quiet --force "$TB_TAG"
else
  echo "clone comm-central ($TB_TAG)"
  git clone --quiet --depth 1 --branch "$TB_TAG" --filter=blob:none --sparse \
    https://github.com/thunderbird/thunderbird-desktop.git "$tb"
fi
git -C "$tb" sparse-checkout set \
  mail/themes/shared/mail \
  mail/components/extensions/schemas \
  mail/config

clone_or_update webext-docs https://github.com/thunderbird/webext-docs.git "$DOCS_BRANCH"
clone_or_update sample-extensions https://github.com/thunderbird/sample-extensions.git master

echo "Thunderbird source: $(cat "$tb/mail/config/version.txt")"
for d in comm-central webext-docs sample-extensions; do
  printf '%-18s %s\n' "$d" "$(git -C "$REF/$d" log -1 --format='%h %cs')"
done
