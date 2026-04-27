#!/usr/bin/env bash
# Restore the GitHub SSH key from the GITHUB_SSH_PRIVATE_KEY Replit Secret
# into ~/.ssh/id_ed25519 so `git push` over SSH works after a container rebuild.
#
# Run after any "Permission denied (publickey)" or "Host key verification
# failed" error, or just whenever the workspace looks freshly rebuilt:
#
#   bash scripts/setup-ssh.sh
#
# Idempotent: safe to run repeatedly. Reconstructs newlines if the secret
# value got pasted as a single line (a common UI quirk).

set -euo pipefail

KEY_PATH="${HOME}/.ssh/id_ed25519"
KNOWN_HOSTS="${HOME}/.ssh/known_hosts"

if [ -z "${GITHUB_SSH_PRIVATE_KEY:-}" ]; then
  echo "ERROR: GITHUB_SSH_PRIVATE_KEY env var is not set." >&2
  echo "Add it as a Replit Secret first (paste the contents of your" >&2
  echo "private-key file, headers and all)." >&2
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
  echo "ERROR: reconstructed key did not validate. The secret value may be corrupted." >&2
  rm -f "${KEY_PATH}"
  exit 1
fi

# Seed github.com host keys so SSH doesn't prompt or refuse.
touch "${KNOWN_HOSTS}"
chmod 600 "${KNOWN_HOSTS}"
if ! grep -q '^github\.com\| github\.com ' "${KNOWN_HOSTS}" 2>/dev/null; then
  ssh-keyscan -t ed25519,rsa github.com 2>/dev/null >> "${KNOWN_HOSTS}"
fi

# Smoke test. SSH always exits non-zero against github.com because GitHub
# closes the channel ("does not provide shell access"), so we check the
# stdout/stderr text instead of the exit code.
echo "SSH key restored to ${KEY_PATH}."
echo "Testing GitHub SSH auth..."
SSH_OUT="$(ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes git@github.com 2>&1 || true)"
if printf '%s' "$SSH_OUT" | grep -q "successfully authenticated"; then
  echo "OK — git push over SSH should work now."
else
  echo "WARNING: GitHub did not confirm authentication. Check that the matching"
  echo "         public key is registered at https://github.com/settings/keys"
  echo "         (or as a deploy key on the repo)."
  echo "ssh said:"
  printf '%s\n' "$SSH_OUT" | sed 's/^/  /'
  exit 1
fi
