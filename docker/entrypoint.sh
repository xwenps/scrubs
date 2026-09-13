#!/bin/sh
# Container entrypoint: bake the environment into the served config, then run nginx.
#
# Doing this at *start* rather than at build time is what lets one image be
# promoted between environments unchanged.
set -eu

/usr/local/bin/write-runtime-config.sh /usr/share/nginx/html/config/runtime-config.js

exec "$@"
