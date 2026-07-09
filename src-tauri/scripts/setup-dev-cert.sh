#!/bin/sh
# One-time setup: creates a self-signed code-signing identity in the login
# keychain and trusts it, so macos-dev-runner.sh can sign dev builds with a
# stable identity instead of a fresh ad-hoc one every rebuild. The final
# trust step still shows macOS's own confirmation dialog — that's a system
# security boundary this script can't (and shouldn't) skip.
set -eu

NAME="${GRIDEN_CODESIGN_IDENTITY:-Griden Dev}"
KEYCHAIN="${GRIDEN_KEYCHAIN:-login.keychain-db}"

if security find-identity -v -p codesigning | grep -q "\"$NAME\""; then
  echo "Identity '$NAME' already exists, nothing to do."
  exit 0
fi

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

cat > "$tmpdir/codesign.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
EOF

openssl req -x509 -newkey rsa:2048 -keyout "$tmpdir/key.pem" -out "$tmpdir/cert.pem" \
  -days 3650 -nodes -config "$tmpdir/codesign.cnf"

security import "$tmpdir/key.pem" -k "$KEYCHAIN" -T /usr/bin/codesign
security import "$tmpdir/cert.pem" -k "$KEYCHAIN" -T /usr/bin/codesign

echo "Trusting '$NAME' for code signing — approve the system prompt that appears."
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$tmpdir/cert.pem"

echo "Done. '$NAME' is ready — tauri dev / cargo run will sign with it from now on."
