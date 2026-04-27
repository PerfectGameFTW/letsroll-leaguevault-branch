#!/usr/bin/env bash
# Restore the GitHub SSH key from the GITHUB_SSH_PRIVATE_KEY Replit Secret
# into ~/.ssh/id_ed25519 and seed ~/.ssh/known_hosts with GitHub's published
# host keys, so `git push` over SSH works after a container rebuild.
#
# Usage:
#   bash scripts/setup-ssh.sh           # interactive: validate + smoke test
#   bash scripts/setup-ssh.sh --quiet   # boot mode: silent if secret missing
#
# Idempotent and offline-safe in --quiet mode (no network calls). Used by:
#   - the `Start application` workflow on every container boot
#   - scripts/post-merge.sh after every task merge
#   - manual invocation when debugging an SSH issue
#
# Reconstructs newlines if the secret value got pasted as a single line
# (a common UI quirk).

set -euo pipefail

KEY_PATH="${HOME}/.ssh/id_ed25519"
KNOWN_HOSTS="${HOME}/.ssh/known_hosts"
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

log() { [ "$QUIET" = "0" ] && echo "$@"; }
warn() { echo "$@" >&2; }

if [ -z "${GITHUB_SSH_PRIVATE_KEY:-}" ]; then
  if [ "$QUIET" = "1" ]; then
    # Boot mode: missing secret is not fatal — the user just hasn't
    # configured git push yet. Exit silently so we don't spam the
    # workflow log on every container start.
    exit 0
  fi
  warn "ERROR: GITHUB_SSH_PRIVATE_KEY env var is not set."
  warn "Add it as a Replit Secret first (paste the contents of your"
  warn "private-key file, headers and all)."
  exit 1
fi

mkdir -p "${HOME}/.ssh"
chmod 700 "${HOME}/.ssh"

# Reconstruct the multi-line PEM format from a possibly-collapsed paste.
node - <<'NODE' > "${KEY_PATH}.tmp"
const raw = process.env.GITHUB_SSH_PRIVATE_KEY || '';
const BEGIN = '-----BEGIN OPENSSH PRIVATE KEY-----';
const END   = '-----END OPENSSH PRIVATE KEY-----';
const s = raw.trim();
const beginIdx = s.indexOf(BEGIN);
const endIdx   = s.indexOf(END);
if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
  console.error('GITHUB_SSH_PRIVATE_KEY is missing the BEGIN/END markers.');
  process.exit(1);
}
const body = s.slice(beginIdx + BEGIN.length, endIdx).replace(/\s+/g, '');
const wrapped = body.match(/.{1,70}/g) || [];
process.stdout.write(BEGIN + '\n' + wrapped.join('\n') + '\n' + END + '\n');
NODE

mv "${KEY_PATH}.tmp" "${KEY_PATH}"
chmod 600 "${KEY_PATH}"

# Validate by deriving the public key (proves the file is structurally valid).
if ! ssh-keygen -y -f "${KEY_PATH}" >/dev/null 2>&1; then
  warn "ERROR: reconstructed key did not validate. The secret value may be corrupted."
  rm -f "${KEY_PATH}"
  exit 1
fi

# Seed ~/.ssh/known_hosts with GitHub's published host keys. Hardcoded
# (not ssh-keyscan'd) so this works offline at boot AND so we never
# trust whatever happens to answer DNS for github.com — these are the
# canonical public host keys from
#   https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
# Verify against that page when GitHub rotates a key.
GITHUB_HOSTKEYS=$(cat <<'EOF'
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=
EOF
)

touch "${KNOWN_HOSTS}"
chmod 600 "${KNOWN_HOSTS}"
# Drop any pre-existing github.com entries (TOFU artifacts from
# `ssh-keyscan` runs, partial answers from earlier attempts, etc.) and
# rewrite with the canonical set. Using a temp file keeps replacement
# atomic.
{
  grep -v -E '^[# ]*github\.com[ ,]' "${KNOWN_HOSTS}" 2>/dev/null || true
  printf '%s\n' "${GITHUB_HOSTKEYS}"
} > "${KNOWN_HOSTS}.tmp"
mv "${KNOWN_HOSTS}.tmp" "${KNOWN_HOSTS}"
chmod 600 "${KNOWN_HOSTS}"

if [ "$QUIET" = "1" ]; then
  # Boot mode: skip the network smoke test. The key is restored and
  # known_hosts is seeded; that's enough for `git push` to succeed
  # without prompting. The first manual git operation will exercise
  # the network path.
  exit 0
fi

# Smoke test. SSH always exits non-zero against github.com because GitHub
# closes the channel ("does not provide shell access"), so we check the
# stdout/stderr text instead of the exit code.
log "SSH key restored to ${KEY_PATH}."
log "Testing GitHub SSH auth..."
SSH_OUT="$(ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes git@github.com 2>&1 || true)"
if printf '%s' "$SSH_OUT" | grep -q "successfully authenticated"; then
  log "OK — git push over SSH should work now."
else
  warn "WARNING: GitHub did not confirm authentication. Check that the matching"
  warn "         public key is registered at https://github.com/settings/keys"
  warn "         (or as a deploy key on the repo)."
  warn "ssh said:"
  printf '%s\n' "$SSH_OUT" | sed 's/^/  /' >&2
  exit 1
fi
