#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Deployment error: %s\n' "$*" >&2
  exit 1
}

if [[ ${GITHUB_EVENT_NAME:-} != push || ${GITHUB_REF:-} != refs/heads/develop ]]; then
  echo 'Only pushes to develop may deploy staging.'
  exit 0
fi

for name in STAGING_HOST STAGING_USER STAGING_ROOT STAGING_URL STAGING_SSH_KEY STAGING_KNOWN_HOSTS GITHUB_SHA GITHUB_RUN_ID GITHUB_RUN_ATTEMPT; do
  [[ -n ${!name:-} ]] || fail "Missing configuration: $name"
done

port=${STAGING_PORT:-22}
[[ $port =~ ^[0-9]{1,5}$ && $port -ge 1 && $port -le 65535 ]] || fail 'Invalid SSH port'
[[ $STAGING_HOST =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || fail 'SSH host must be an IPv4 address or DNS name'
[[ $STAGING_USER =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'Invalid deployment user'
[[ $STAGING_ROOT =~ ^/([a-zA-Z0-9_-]+/)+[a-zA-Z0-9_-]+$ ]] || fail 'Use an absolute, dedicated staging root without spaces, dots, or trailing slash'
[[ $STAGING_URL =~ ^https?://[a-zA-Z0-9.-]+(:[0-9]+)?(/[a-zA-Z0-9_-]+)*/?$ ]] || fail 'Invalid staging URL'
[[ $GITHUB_SHA =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid commit SHA'
[[ $GITHUB_RUN_ID =~ ^[0-9]+$ && $GITHUB_RUN_ATTEMPT =~ ^[0-9]+$ ]] || fail 'Invalid workflow run identifier'

archive=${1:?Build archive is required}
[[ -f $archive ]] || fail 'Build archive is missing'
script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
release_id="$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"

is_latest() {
  local latest
  latest=$(git ls-remote --exit-code origin refs/heads/develop) || fail 'Cannot check remote develop head'
  latest=${latest%%[[:space:]]*}
  [[ $latest == "$GITHUB_SHA" ]]
}

if ! is_latest; then
  echo 'Skipping superseded develop build.'
  exit 0
fi

umask 077
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
printf '%s\n' "$STAGING_SSH_KEY" > "$temporary/key"
printf '%s\n' "$STAGING_KNOWN_HOSTS" > "$temporary/known_hosts"
ssh_options=(
  -F /dev/null
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$temporary/known_hosts"
  -o ConnectTimeout=15
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=3
  -i "$temporary/key"
)
target="$STAGING_USER@$STAGING_HOST"

remote() {
  local command
  printf -v command 'bash -s -- %q %q %q %q %q' "$1" "$STAGING_ROOT" "$release_id" "$GITHUB_SHA" "$STAGING_URL"
  ssh "${ssh_options[@]}" -p "$port" "$target" "$command" < "$script_directory/staging-release.sh"
}

remote prepare
scp "${ssh_options[@]}" -P "$port" "$archive" "$target:$STAGING_ROOT/incoming/$release_id.tar.gz"

if ! is_latest; then
  remote discard
  echo 'Skipping build superseded during upload.'
  exit 0
fi

remote publish
if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
  printf '### Staging deployed\n\nCommit: `%s`\n\nRelease: `%s`\n' "$GITHUB_SHA" "$release_id" >> "$GITHUB_STEP_SUMMARY"
fi
