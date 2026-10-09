#!/usr/bin/env python3
"""Swap the web app inside a Capacitor APK and zipalign the result.

usage: repack_apk.py <original.apk> <web-dir> <unsigned-out.apk>

Every entry of the original APK is copied unchanged except
assets/public/** (replaced by <web-dir>) and the old v1 signature files.
Stored (uncompressed) entries are padded so their data starts on a 4-byte
boundary, which Android requires for resources.arsc. The output still has
to be signed (see build-apk.sh).
"""
import os
import sys
import zipfile

WEB_PREFIX = "assets/public/"
SIGNATURE_SUFFIXES = (".SF", ".RSA", ".DSA", ".EC")
# Already-compressed formats are stored, matching how the original build packed them.
STORED_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".mp4")


def is_old_signature(name):
    upper = name.upper()
    return upper.startswith("META-INF/") and (
        upper.endswith(SIGNATURE_SUFFIXES) or upper == "META-INF/MANIFEST.MF"
    )


def write_aligned(zout, info, data):
    """Write an entry, padding the local header so stored data is 4-byte aligned."""
    info.extra = b""
    if info.compress_type == zipfile.ZIP_STORED:
        data_start = zout.fp.tell() + 30 + len(info.filename.encode("utf-8"))
        info.extra = b"\0" * (-data_start % 4)
    zout.writestr(info, data)


def web_files(web_dir):
    for root, _dirs, files in os.walk(web_dir):
        for name in files:
            path = os.path.join(root, name)
            yield os.path.relpath(path, web_dir).replace(os.sep, "/"), path


def main(src_apk, web_dir, out_apk):
    with zipfile.ZipFile(src_apk) as zin, zipfile.ZipFile(out_apk, "w") as zout:
        for info in zin.infolist():
            if info.filename.startswith(WEB_PREFIX) or is_old_signature(info.filename):
                continue
            copy = zipfile.ZipInfo(info.filename, info.date_time)
            copy.compress_type = info.compress_type
            copy.external_attr = info.external_attr
            write_aligned(zout, copy, zin.read(info))

        for rel, path in sorted(web_files(web_dir)):
            info = zipfile.ZipInfo(WEB_PREFIX + rel, (1981, 1, 1, 1, 1, 2))
            info.compress_type = (
                zipfile.ZIP_STORED
                if rel.lower().endswith(STORED_EXTENSIONS)
                else zipfile.ZIP_DEFLATED
            )
            with open(path, "rb") as f:
                write_aligned(zout, info, f.read())


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
