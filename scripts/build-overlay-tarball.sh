#!/bin/bash
# build-overlay-tarball.sh
# Assembles a rootfs-overlay tarball from the clean r5 ipk.
# Extracts the ipk payload into a staging tree with the exact
# OpenWrt target layout, then tars as
#   dist/luci-app-access-shield-1.0.0-r7-overlay.tar.gz
#
# Ownership in the archive is forced to root:root via tar's
# --owner/--group flags, so no chown (and no sudo) is required.
#
# Run from anywhere; the script resolves paths itself.

set -e

REPO="$HOME/projects/luci-app-access-shield"
IPK="$HOME/sdk-access-shield/sdk/bin/packages/x86_64/base/luci-app-access-shield_1.0.0-r7_all.ipk"
WORK="$(mktemp -d /tmp/as-overlay.XXXXXX)"
STAGE="$WORK/root"
OUT="$REPO/dist"

mkdir -p "$OUT"

if [ ! -f "$IPK" ]; then
    echo "FAIL: ipk not found at $IPK"
    exit 1
fi

echo "[1/5] Extracting ipk payload..."
cd "$WORK"
tar xzf "$IPK"
mkdir -p "$STAGE"
tar xzf data.tar.gz -C "$STAGE"

echo "[2/5] Verifying no .bak files in payload..."
STRAYS=$(find "$STAGE" -name '*.bak*' | wc -l)
if [ "$STRAYS" -ne 0 ]; then
    echo "FAIL: $STRAYS .bak files found:"
    find "$STAGE" -name '*.bak*'
    exit 1
fi

echo "[3/5] Setting permissions (no chown; tar handles ownership)..."
find "$STAGE/etc/init.d"       -type f -exec chmod 0755 {} \;
find "$STAGE/etc/uci-defaults" -type f -exec chmod 0755 {} \;
find "$STAGE/etc/hotplug.d"    -type f -exec chmod 0755 {} \;
find "$STAGE/usr/bin"          -type f -exec chmod 0755 {} \;
find "$STAGE/usr/libexec"      -type f -exec chmod 0755 {} \;
chmod 0644 "$STAGE/etc/config/access_shield"
find "$STAGE/www"              -type f -exec chmod 0644 {} \;
find "$STAGE/usr/share"        -type f -exec chmod 0644 {} \;

echo "[4/5] Creating tarball (ownership forced to root:root)..."
TARBALL="$OUT/luci-app-access-shield-1.0.0-r7-overlay.tar.gz"
cd "$STAGE"
tar czf "$TARBALL" --owner=0 --group=0 --numeric-owner .
cd "$WORK"

echo "[5/5] Verifying tarball..."
FILE_COUNT=$(tar tzf "$TARBALL" | grep -v '/$' | wc -l)
echo "  Files in tarball: $FILE_COUNT"
echo "  Size:             $(du -h "$TARBALL" | cut -f1)"
echo "  SHA256:           $(sha256sum "$TARBALL" | cut -d' ' -f1)"

echo
echo "=== First 12 entries (verify root:root ownership) ==="
tar tzvf "$TARBALL" | head -12

echo
echo "=== Full sorted listing ==="
tar tzf "$TARBALL" | sort

echo
echo "OK. Tarball: $TARBALL"
rm -rf "$WORK"
