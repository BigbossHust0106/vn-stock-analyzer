#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=8.30.0
case "$(uname -s)" in Linux) os=linux;; Darwin) os=darwin;; *) echo 'Dùng Linux/macOS hoặc WSL2 để chạy verify'; exit 1;; esac
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Kiến trúc chưa được hỗ trợ'; exit 1;; esac
mkdir -p .tools
if [[ -x .tools/gitleaks ]] && [[ "$(.tools/gitleaks version)" == "$version" ]]; then exit 0; fi
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
artifact="gitleaks_${version}_${os}_${arch}.tar.gz"
base="https://github.com/gitleaks/gitleaks/releases/download/v${version}"
curl --fail --location --silent --show-error --retry 2 "$base/$artifact" -o "$tmpdir/$artifact"
curl --fail --location --silent --show-error --retry 2 "$base/gitleaks_${version}_checksums.txt" -o "$tmpdir/checksums.txt"
expected=$(awk -v name="$artifact" '$2 == name { print $1 }' "$tmpdir/checksums.txt")
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { echo 'Không tìm thấy checksum chính thức'; exit 1; }
actual=$(shasum -a 256 "$tmpdir/$artifact" | awk '{print $1}')
[[ "$actual" == "$expected" ]] || { echo 'Checksum Gitleaks không khớp'; exit 1; }
tar -xzf "$tmpdir/$artifact" -C "$tmpdir" gitleaks
install -m 0755 "$tmpdir/gitleaks" .tools/gitleaks
.tools/gitleaks version
