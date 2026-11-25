#!/usr/bin/env python3
"""
PC Bluetooth Receiver & File Ingestion Helper for Mobile Attendance System.

Supports three modes using Python 3 standard library only:
  1. One-shot CLI file import:
       python3 server/bluetooth_receiver.py --file path/to/sheet.json
  2. Folder watcher for Bluetooth received files:
       python3 server/bluetooth_receiver.py --mode watch --watch-dir ~/Downloads
  3. Direct Linux Bluetooth RFCOMM SPP listener (matches Android BluetoothTransferManager):
       python3 server/bluetooth_receiver.py --mode bluetooth --channel 1
"""

import argparse
import json
import os
import shutil
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_SERVER_URL = "http://127.0.0.1:3000/api/transfers/upload"
SUPPORTED_EXTENSIONS = {".json", ".csv"}


def post_attendance_content(server_url: str, filename: str, content: str, transfer_method: str = "bluetooth") -> dict:
    """Uploads JSON or CSV attendance file content to the PC Server API."""
    payload = json.dumps({
        "filename": filename,
        "content": content,
        "transferMethod": transfer_method,
        "sourceDevice": f"PC Bluetooth Receiver ({filename})",
    }).encode("utf-8")

    req = urllib.request.Request(
        server_url,
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Server returned HTTP {err.code}: {detail}") from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"Cannot reach PC server at {server_url}: {err.reason}") from err


def import_file(file_path: Path, server_url: str, transfer_method: str = "bluetooth") -> dict:
    if not file_path.is_file():
        raise FileNotFoundError(f"File not found: {file_path}")
    content = file_path.read_text(encoding="utf-8-sig")
    return post_attendance_content(server_url, file_path.name, content, transfer_method)


def run_watch_mode(watch_dir: Path, server_url: str, poll_interval: float) -> None:
    watch_dir.mkdir(parents=True, exist_ok=True)
    processed_dir = watch_dir / "processed"
    processed_dir.mkdir(parents=True, exist_ok=True)
    print(f"[Watch Mode] Monitoring {watch_dir} for .json / .csv attendance files...")
    print(f"[Watch Mode] Forwarding to {server_url} (Ctrl+C to stop)")

    try:
        while True:
            for item in sorted(watch_dir.iterdir()):
                if not item.is_file():
                    continue
                if item.suffix.lower() not in SUPPORTED_EXTENSIONS:
                    continue
                if item.name.startswith("."):
                    continue

                try:
                    result = import_file(item, server_url, "bluetooth")
                    print(f"[Imported] {item.name} -> {result.get('importedCount', 0)} sheet(s)")
                    dest = processed_dir / f"{int(time.time())}-{item.name}"
                    shutil.move(str(item), str(dest))
                except Exception as exc:
                    print(f"[Error] Failed to import {item.name}: {exc}", file=sys.stderr)
            time.sleep(poll_interval)
    except KeyboardInterrupt:
        print("\n[Watch Mode] Stopped.")


def run_bluetooth_rfcomm_mode(channel: int, server_url: str, inbox_dir: Path) -> None:
    if not hasattr(socket, "AF_BLUETOOTH") or not hasattr(socket, "BTPROTO_RFCOMM"):
        print(
            "Error: This Python build or OS does not expose socket.AF_BLUETOOTH / BTPROTO_RFCOMM.\n"
            "Use --mode watch --watch-dir <bluetooth-download-folder> or --file <path> instead.",
            file=sys.stderr,
        )
        sys.exit(2)

    inbox_dir.mkdir(parents=True, exist_ok=True)
    bdaddr_any = getattr(socket, "BDADDR_ANY", "00:00:00:00:00:00")
    srv_sock = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM)

    try:
        srv_sock.bind((bdaddr_any, channel))
        srv_sock.listen(1)
    except OSError as exc:
        srv_sock.close()
        print(
            f"Error binding Bluetooth RFCOMM channel {channel}: {exc}\n"
            "Ensure Bluetooth adapter is powered on, or use --mode watch for OS Bluetooth file receives.",
            file=sys.stderr,
        )
        sys.exit(2)

    print(f"[Bluetooth RFCOMM] Listening on channel {channel} -> {server_url}")
    try:
        while True:
            client_sock, client_info = srv_sock.accept()
            print(f"[Bluetooth] Connection from {client_info}")
            chunks = []
            try:
                while True:
                    data = client_sock.recv(4096)
                    if not data:
                        break
                    chunks.append(data)
            finally:
                client_sock.close()

            raw_text = b"".join(chunks).decode("utf-8", errors="replace").strip()
            if not raw_text:
                continue

            ext = ".json" if raw_text.startswith("{") or raw_text.startswith("[") else ".csv"
            filename = f"bt-sheet-{int(time.time())}{ext}"
            saved_path = inbox_dir / filename
            saved_path.write_text(raw_text, encoding="utf-8")

            try:
                result = post_attendance_content(server_url, filename, raw_text, "bluetooth")
                print(f"[Bluetooth Imported] {filename} -> {result.get('importedCount', 0)} sheet(s)")
            except Exception as exc:
                print(f"[Bluetooth Error] Saved to {saved_path}, upload failed: {exc}", file=sys.stderr)
    except KeyboardInterrupt:
        print("\n[Bluetooth RFCOMM] Stopped.")
    finally:
        srv_sock.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="PC Bluetooth Receiver & File Importer for Mobile Attendance System"
    )
    parser.add_argument(
        "--mode",
        choices=["file", "watch", "bluetooth"],
        default="file",
        help="Operation mode: 'file' (one-shot import), 'watch' (folder monitor), or 'bluetooth' (RFCOMM SPP listener)",
    )
    parser.add_argument("--file", type=Path, help="Path to .json or .csv attendance file (for --mode file)")
    parser.add_argument(
        "--watch-dir",
        type=Path,
        default=Path.home() / "Downloads",
        help="Directory to watch for incoming Bluetooth files (default: ~/Downloads)",
    )
    parser.add_argument(
        "--server",
        default=DEFAULT_SERVER_URL,
        help=f"PC Server upload endpoint (default: {DEFAULT_SERVER_URL})",
    )
    parser.add_argument("--channel", type=int, default=1, help="Bluetooth RFCOMM channel (default: 1)")
    parser.add_argument("--interval", type=float, default=2.0, help="Watch poll interval in seconds (default: 2.0)")
    args = parser.parse_args()

    if args.file is not None or args.mode == "file":
        if args.file is None:
            parser.error("--file is required when --mode is 'file'")
        try:
            result = import_file(args.file, args.server, "bluetooth")
            print(json.dumps(result, indent=2))
            return 0
        except Exception as exc:
            print(f"Import failed: {exc}", file=sys.stderr)
            return 1

    if args.mode == "watch":
        run_watch_mode(args.watch_dir, args.server, args.interval)
        return 0

    if args.mode == "bluetooth":
        inbox = Path(__file__).resolve().parent / "data" / "bluetooth_inbox"
        run_bluetooth_rfcomm_mode(args.channel, args.server, inbox)
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
