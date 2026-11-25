#!/usr/bin/env bash
# Build the app for an iOS simulator and run every Maestro flow in e2e/maestro/. Run it on a Mac
# with Xcode, Maestro (needs Java 17+) and Node. See e2e/README.md.
#
# Environment (optional):
#   E2E_SIMULATOR  simulator name or UDID (default: first available iPhone)
#   E2E_OUT        where Maestro's report and screenshots go (default: e2e/out, gitignored)
set -euo pipefail
export PATH="$HOME/.maestro/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

for tool in node npx xcrun maestro; do
  command -v "$tool" >/dev/null || { echo "$tool is not on PATH" >&2; exit 1; }
done

udid="$(xcrun simctl list devices available --json | node -e '
  const want = process.argv[1];
  const devices = Object.values(JSON.parse(require("fs").readFileSync(0, "utf8")).devices).flat();
  const hit = want ? devices.find((d) => d.udid === want || d.name === want) : devices.find((d) => d.name.startsWith("iPhone"));
  if (!hit) process.exit(1);
  console.log(hit.udid);
' "${E2E_SIMULATOR:-}")" || { echo "no simulator matches '${E2E_SIMULATOR:-iPhone}'" >&2; exit 1; }
echo "Simulator: $udid"
xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl bootstatus "$udid" -b

# Release bundles the JS into the app, so no Metro server has to be running.
npx expo run:ios --configuration Release --device "$udid" --no-bundler

out="${E2E_OUT:-e2e/out}"
mkdir -p "$out"
maestro --device "$udid" test e2e/maestro --format junit --output "$out/report.xml" --debug-output "$out/debug"
