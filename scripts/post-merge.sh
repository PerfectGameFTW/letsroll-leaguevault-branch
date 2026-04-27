#!/bin/bash
set -e
npm install
npm run db:push -- --force
# Re-seed ~/.ssh/id_ed25519 + known_hosts so `git push` keeps working
# after a task merge (the merged container can land on a fresh box
# where ~/.ssh/ doesn't exist yet). --quiet exits 0 silently if the
# GITHUB_SSH_PRIVATE_KEY secret is not configured, so a missing-key
# setup never breaks post-merge.
bash scripts/setup-ssh.sh --quiet || true
