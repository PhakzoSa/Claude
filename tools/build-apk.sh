#!/usr/bin/env bash
# Rebuild the Android APK with the current app/ folder swapped in.
#
#   tools/build-apk.sh <original.apk> [out.apk]
#
# Signs with $KEYSTORE / $KEYSTORE_PASSWORD / $KEY_ALIAS. Point KEYSTORE at
# the keystore that signed the original (for a debug build that is
# ~/.android/debug.keystore, password "android", alias "androiddebugkey")
# and the result installs as an update. Without it a throwaway debug key is
# generated, so the old app must be uninstalled first.
#
# Needs python3, a JDK (11+) and curl.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
src=${1:?usage: tools/build-apk.sh <original.apk> [out.apk]}
out=${2:-$root/release/VarsityMart-preview.apk}
cache=$root/.build
mkdir -p "$cache" "$(dirname "$out")"

jar=$cache/apksig-2.3.0.jar
if [ ! -f "$jar" ]; then
  curl -fsSL -o "$jar" \
    https://repo1.maven.org/maven2/com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar
  echo "6ef7a58375aa68fb492b58edd97607bee8ee5c5c  $jar" | sha1sum -c --quiet -
fi

keystore=${KEYSTORE:-$cache/debug.p12}
storepass=${KEYSTORE_PASSWORD:-android}
alias=${KEY_ALIAS:-androiddebugkey}
if [ ! -f "$keystore" ]; then
  keytool -genkeypair -keystore "$keystore" -storetype PKCS12 \
    -storepass "$storepass" -alias "$alias" -keyalg RSA -keysize 2048 \
    -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
fi

javac -d "$cache" -cp "$jar" "$here/ApkTool.java"
python3 "$here/repack_apk.py" "$src" "$root/app" "$cache/unsigned.apk"

# apksig 2.3.0 predates the module system and uses JDK-internal classes.
jvm=(--add-exports java.base/sun.security.x509=ALL-UNNAMED
  --add-exports java.base/sun.security.pkcs=ALL-UNNAMED
  --add-exports java.base/sun.security.util=ALL-UNNAMED
  -cp "$jar:$cache")
rm -f "$out"
java "${jvm[@]}" ApkTool sign "$cache/unsigned.apk" "$out" "$keystore" "$storepass" "$alias"
java "${jvm[@]}" ApkTool verify "$out"
echo "Built $out"
