#!/bin/bash
cd "$(dirname "$0")" || exit 1
[ -d node_modules ] || npm install
if ! curl -s -m 1 -o /dev/null http://localhost:4477/; then
  node server.js &
  SERVER=$!
  trap 'kill $SERVER' EXIT
  sleep 1
fi
open http://localhost:4477
wait
