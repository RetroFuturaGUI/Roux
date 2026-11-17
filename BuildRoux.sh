#!/bin/sh
# Builds everything of Roux: the core, the CLI and the web version (npm run build), the VS Code extension's .vsix and the
# JetBrains plugin's .zip, both copied to dist/. The web version needs nothing more: roux serve serves the UI as it is.
# The JetBrains plugin needs an installed JetBrains IDE named in hosts/jetbrains/local.properties (rouxIde=<its folder>);
# without one it is skipped. Java comes from JAVA_HOME, else from that IDE's own runtime.
set -e
cd "$(dirname "$0")"

echo "=== npm packages"
npm install

echo "=== Roux: core, CLI, web version and the VS Code extension's code"
npm run build

echo "=== VS Code extension"
(cd hosts/vscode && npm run package)
mkdir -p dist
cp hosts/vscode/*.vsix dist/

echo "=== JetBrains plugin"
ide=""
if [ -f hosts/jetbrains/local.properties ]; then
    ide="$(sed -n 's/^rouxIde=//p' hosts/jetbrains/local.properties | tr -d '\r')"
fi

if [ -z "$ide" ]; then
    echo "Skipped: name an installed JetBrains IDE in hosts/jetbrains/local.properties, as rouxIde=<its folder>"
else
    if [ -z "$JAVA_HOME" ]; then
        export JAVA_HOME="$ide/jbr"
    fi

    (cd hosts/jetbrains && ./gradlew buildPlugin --no-daemon -q)
    cp hosts/jetbrains/build/distributions/*.zip dist/
fi

echo
echo "Done. The packages are in $(pwd)/dist"
