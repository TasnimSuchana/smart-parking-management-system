#!/bin/sh
# Runs once on first start of an empty data volume. Creates one least-privilege user per service database.
set -eu
for svc in auth user parking booking vehicle payment camera notification analytics audit; do
mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin <<JS
db = db.getSiblingDB("${svc}_db");
db.createUser({ user: "${svc}_user", pwd: "$MONGO_APP_PASSWORD", roles: [{ role: "readWrite", db: "${svc}_db" }] });
JS
done
