#!/bin/sh
# Opens Roux in the web browser. The project is the folder given (./Roux.sh <project folder>), else the one Roux lies in,
# as when Roux is a project's submodule. Ctrl+C, or closing the terminal, stops Roux.
if [ -n "$1" ]; then
    project="$(cd "$1" && pwd)" || exit 1
fi

cd "$(dirname "$0")" || exit 1

failed()
{
    echo
    echo "Roux couldn't start. Node 22 or newer is needed: https://nodejs.org"
    printf "Press Enter to close this window."
    read -r _
    exit 1
}

if [ ! -d node_modules ]; then
    echo "Installing Roux's packages, the first time only..."
    npm install || failed
fi

if [ -n "$project" ]; then
    npm run serve -- --project "$project" || failed
else
    npm run serve || failed
fi
