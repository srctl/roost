#!/bin/sh
set -eu
if [ "$#" -lt 2 ]; then
  echo 'Usage: sh install.sh OWNER/REPO VERSION [setup options]' >&2
  exit 1
fi
repository=$1
version=$2
shift 2
case "$repository" in *[!a-zA-Z0-9_./-]*|../*|*/../*|/*) echo 'Invalid repository' >&2; exit 1;; esac
if ! printf '%s\n' "$repository" | grep -Eq '^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$'; then exit 1; fi
if ! printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then echo 'Use an exact version, such as 0.1.0' >&2; exit 1; fi
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then echo 'Roost currently supports Linux x64.' >&2; exit 1; fi
if [ "$(id -u)" = 0 ]; then echo 'Run as your normal user; setup uses sudo for systemd.' >&2; exit 1; fi
for dependency in curl tar sha256sum systemctl sudo; do command -v "$dependency" >/dev/null || { echo "Missing $dependency" >&2; exit 1; }; done
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
base="https://github.com/$repository/releases/download/v$version"
curl -fsSL --retry 3 "$base/roost-linux-x64.tar.gz" -o "$work/roost-linux-x64.tar.gz"
curl -fsSL --retry 3 "$base/SHA256SUMS" -o "$work/SHA256SUMS"
(cd "$work" && sha256sum --check --strict SHA256SUMS)
mkdir "$work/release"
tar -xzf "$work/roost-linux-x64.tar.gz" --no-same-owner -C "$work/release"
"$work/release/bin/roost" setup --repository "$repository" "$@"
