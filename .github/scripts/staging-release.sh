#!/usr/bin/env bash
set -euo pipefail
umask 022

fail() {
  printf 'Release error: %s\n' "$*" >&2
  exit 1
}

mode=${1:?Operation is required}
root=${2:?Staging root is required}
release_id=${3:?Release identifier is required}
sha=${4:?Commit SHA is required}
url=${5:?Staging URL is required}

[[ $mode == prepare || $mode == publish || $mode == discard ]] || fail 'Invalid operation'
[[ $root =~ ^/([a-zA-Z0-9_-]+/)+[a-zA-Z0-9_-]+$ ]] || fail 'Invalid staging root'
[[ $sha =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid commit SHA'
[[ $release_id =~ ^$sha-[0-9]+-[0-9]+$ ]] || fail 'Invalid release identifier'
[[ $url =~ ^https?://[a-zA-Z0-9.-]+(:[0-9]+)?(/[a-zA-Z0-9_-]+)*/?$ ]] || fail 'Invalid staging URL'
[[ -d $root && ! -L $root && $(realpath -- "$root") == "$root" ]] || fail 'Staging root must already exist and not traverse symlinks'

for directory in incoming releases; do
  [[ ! -L $root/$directory ]] || fail 'Deployment directories must not be symlinks'
  mkdir -p -- "$root/$directory"
done
archive="$root/incoming/$release_id.tar.gz"
release="$root/releases/$release_id"

case "$mode" in
  prepare)
    [[ ! -e $archive && ! -e $release ]] || fail 'Release already exists'
    exit 0
    ;;
  discard)
    rm -f -- "$archive"
    exit 0
    ;;
esac

command -v flock > /dev/null || fail 'flock is required'
exec 9> "$root/.deploy.lock"
flock -x -w 300 9 || fail 'Another staging deployment holds the lock'
[[ -f $archive && ! -L $archive && ! -e $release ]] || fail 'Invalid or duplicate release archive'
[[ ! -e $root/current || -L $root/current ]] || fail 'current must be a symlink, not a directory'

previous=''
if [[ -L $root/current ]]; then
  previous=$(readlink -f -- "$root/current")
  [[ $previous == "$root/releases/"* && -d $previous ]] || fail 'current must point to an existing release inside staging'
fi

activated=false
healthy=false
temporary_link="$root/.current-$release_id"
health_file="$root/incoming/$release_id.health"

cleanup() {
  local status=$?
  trap - EXIT
  if [[ $activated == true && $healthy != true ]]; then
    echo 'Health check failed or deployment interrupted; restoring previous release.' >&2
    rm -f -- "$temporary_link"
    if [[ -n $previous ]]; then
      ln -s -- "$previous" "$temporary_link"
      mv -Tf -- "$temporary_link" "$root/current"
    else
      rm -f -- "$root/current"
    fi
  fi
  rm -f -- "$temporary_link" "$health_file" "$archive"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

tar -tzf "$archive" > "$health_file"
while IFS= read -r entry; do
  [[ $entry != /* && ! $entry =~ (^|/)\.\.(/|$) ]] || fail 'Unsafe path in build archive'
done < "$health_file"
tar -tvzf "$archive" > "$health_file"
while IFS= read -r entry; do
  [[ $entry == -* || $entry == d* ]] || fail 'Build archive may only contain regular files and directories'
done < "$health_file"

mkdir -- "$release"
tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$release"
for asset in index.html models/PP-OCRv5_mobile_det_infer.onnx models/PP-OCRv5_mobile_rec_infer.onnx models/ppocr_keys_v5.txt; do
  [[ -s $release/$asset ]] || fail "Build is missing $asset"
done
[[ -d $release/assets && -n $(find "$release/assets" -type f -name '*.wasm' -size +0c -print -quit) ]] || fail 'Build is missing runtime WASM'
printf '%s\n' "$sha" > "$release/scrubshot-release.txt"

ln -s -- "$release" "$temporary_link"
activated=true
mv -Tf -- "$temporary_link" "$root/current"

cd -- "$release"
assets=(index.html scrubshot-release.txt)
while IFS= read -r asset; do
  assets+=("$asset")
done < <(find models assets -type f \( -name '*.onnx' -o -name '*.txt' -o -name '*.wasm' -o -name '*.js' -o -name '*.css' \) | sort)

for asset in "${assets[@]}"; do
  [[ $asset =~ ^[a-zA-Z0-9_./-]+$ ]] || fail 'Unsupported asset URL'
  curl --fail --silent --show-error --connect-timeout 10 --max-time 120 --retry 2 \
    --header 'Cache-Control: no-cache' --output "$health_file" "${url%/}/$asset?deployment=$release_id"
  cmp -s -- "$release/$asset" "$health_file" || fail "Health check content mismatch: $asset"
done

healthy=true
printf 'Staging release is healthy: %s\n' "$release_id"
