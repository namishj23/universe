#!/bin/zsh
# P7 gates from a fresh clone. Logs to $EV.
set -u
SRC="/Users/ravijain/Desktop/Mini Project Hackathon"
EV="$SRC/docs/audit/P7-evidence/gates"
mkdir -p "$EV"
W=$(mktemp -d /tmp/p7-clone.XXXX)
echo "$W" > "$EV/clone-dir.txt"
step() { local name=$1; shift; local s=$(date +%s); ( "$@" ) > "$EV/$name.log" 2>&1; local rc=$?; echo "$name rc=$rc secs=$(( $(date +%s)-s ))" | tee -a "$EV/summary.txt"; return 0; }
: > "$EV/summary.txt"
git clone -q "$SRC" "$W/repo" && cd "$W/repo" && git checkout -q p1/p7-audit
git log --oneline -1 >> "$EV/summary.txt"
cp "$SRC/apps/api/.env.test" apps/api/.env.test
cp "$SRC/apps/api/.env" apps/api/.env
cp "$SRC/apps/web/.env.visual" apps/web/.env.visual 2>/dev/null
step npm-ci npm ci
step build npm run build
step typecheck npm run typecheck
step typecheck-root npx tsc -p tsconfig.json --noEmit
step lint npm run lint
step test-run1 npm test
step test-run2 npm test
step test-run3 npm test
step test-visual npm run test:visual
step audit-all npm audit
step audit-prod npm audit --omit=dev
step migrate-status env ENV_FILE=apps/api/.env.test npx prisma migrate status
step migrate-diff env ENV_FILE=apps/api/.env.test sh -c 'npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code'
echo DONE >> "$EV/summary.txt"
