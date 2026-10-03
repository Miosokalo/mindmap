#!/bin/sh
# Volume /data wird von Docker als root angelegt — für den node-Nutzer
# beschreibbar machen, dann Rechte fallen lassen (Muster: greener-green-contact).
set -e
mkdir -p /data/maps /data/icons
chown -R node:node /data
exec su-exec node node server.mjs
