#!/usr/bin/env python3

import argparse
from datetime import datetime, timezone
import ipaddress
import json
import socket
import sys
from pathlib import Path


DEFAULT_EXTRA_DATA = "FF:FF:FF:FF:FF:FF"
DEFAULT_UDP_PORT = 9
DEFAULT_WAKE_IP = "255.255.255.255"
SYNC_BYTES = b"\xff" * 6
DEFAULT_DEVICE_FILE = Path(__file__).resolve().parent.parent / "assets" / "devices.json"


def normalize_mac(value: str) -> str:
    parts = value.strip().replace("-", ":").split(":")
    if len(parts) != 6:
        raise ValueError(f"invalid MAC address: {value!r}")

    normalized = []
    for part in parts:
        if len(part) != 2:
            raise ValueError(f"invalid MAC address: {value!r}")
        int(part, 16)
        normalized.append(part.upper())

    return ":".join(normalized)


def mac_to_bytes(value: str) -> bytes:
    return bytes.fromhex(normalize_mac(value).replace(":", ""))


def normalize_host(value: str) -> str:
    return str(ipaddress.IPv4Address(value.strip()))


def normalize_port(value: int) -> int:
    if not 1 <= value <= 65535:
        raise ValueError(f"invalid UDP port: {value}")
    return value


def load_inventory(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            inventory = json.load(handle)
    except FileNotFoundError as exc:
        raise ValueError(f"device file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON in device file {path}: {exc}") from exc

    if not isinstance(inventory, dict):
        raise ValueError(f"device file must contain a JSON object: {path}")

    defaults = inventory.get("defaults", {})
    devices = inventory.get("devices", {})

    if not isinstance(defaults, dict):
        raise ValueError(f"inventory defaults must be an object: {path}")
    if not isinstance(devices, dict):
        raise ValueError(f"inventory devices must be an object: {path}")

    return inventory


def load_or_init_inventory(path: Path) -> dict:
    try:
        inventory = load_inventory(path)
    except ValueError as exc:
        if path.exists():
            raise
        inventory = {}

    defaults = inventory.get("defaults", {})
    devices = inventory.get("devices", {})

    if not isinstance(defaults, dict):
        raise ValueError(f"inventory defaults must be an object: {path}")
    if not isinstance(devices, dict):
        raise ValueError(f"inventory devices must be an object: {path}")

    inventory["defaults"] = defaults
    inventory["devices"] = devices
    return inventory


def resolve_device_file(device_file: str | None) -> Path:
    if device_file:
        return Path(device_file).expanduser().resolve()
    return DEFAULT_DEVICE_FILE


def resolve_device_entry(device: str, device_file: str | None) -> tuple[dict, Path]:
    path = resolve_device_file(device_file)
    inventory = load_inventory(path)
    defaults = inventory.get("defaults", {})
    devices = inventory.get("devices", {})

    if device not in devices:
        raise ValueError(f"device {device!r} not found in {path}")

    entry = devices[device]
    if not isinstance(entry, dict):
        raise ValueError(f"device entry for {device!r} must be an object")

    resolved = dict(defaults)
    resolved.update(entry)
    resolved["device"] = device
    return resolved, path


def resolve_record_path(device_file: str | None, resolved_path: Path | None = None) -> Path:
    if resolved_path is not None:
        return resolved_path
    return resolve_device_file(device_file)


def prefer(cli_value, inventory_value, fallback=None):
    if cli_value is not None:
        return cli_value
    if inventory_value is not None:
        return inventory_value
    return fallback


def normalize_inventory_fields(entry: dict) -> dict:
    normalized = {}

    if "mac" in entry and entry["mac"] is not None:
        normalized["mac"] = normalize_mac(str(entry["mac"]))
    if "host" in entry and entry["host"] is not None:
        normalized["host"] = normalize_host(str(entry["host"]))
    if "broadcast_ip" in entry and entry["broadcast_ip"] is not None:
        normalized["broadcast_ip"] = normalize_host(str(entry["broadcast_ip"]))
    if "extra_data" in entry and entry["extra_data"] is not None:
        normalized["extra_data"] = normalize_mac(str(entry["extra_data"]))
    if "port" in entry and entry["port"] is not None:
        normalized["port"] = normalize_port(int(entry["port"]))
    if "last_action" in entry and entry["last_action"] is not None:
        normalized["last_action"] = str(entry["last_action"])
    if "last_success_at" in entry and entry["last_success_at"] is not None:
        normalized["last_success_at"] = str(entry["last_success_at"])

    return normalized


def find_device_name_by_mac(devices: dict, mac: str) -> str | None:
    for name, entry in devices.items():
        if not isinstance(entry, dict):
            continue
        entry_mac = entry.get("mac")
        if entry_mac is None:
            continue
        try:
            if normalize_mac(str(entry_mac)) == mac:
                return name
        except ValueError:
            continue
    return None


def make_device_name(mac: str) -> str:
    return f"device-{mac.replace(':', '').lower()}"


def save_inventory(path: Path, inventory: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(inventory, handle, indent=2, sort_keys=True)
        handle.write("\n")


def update_inventory_record(
    *,
    action: str,
    device: str | None,
    device_file: str | None,
    resolved_path: Path | None,
    fields: dict,
) -> tuple[str, Path]:
    path = resolve_record_path(device_file, resolved_path)
    inventory = load_or_init_inventory(path)
    devices = inventory["devices"]

    normalized_fields = normalize_inventory_fields(fields)
    mac = normalized_fields.get("mac")

    record_name = device
    if record_name is None and mac is not None:
        record_name = find_device_name_by_mac(devices, mac)
    if record_name is None:
        if mac is None:
            raise ValueError("inventory update requires a mac address")
        record_name = make_device_name(mac)

    existing_entry = devices.get(record_name, {})
    if existing_entry is None:
        existing_entry = {}
    if not isinstance(existing_entry, dict):
        raise ValueError(f"device entry for {record_name!r} must be an object")

    updated_entry = dict(existing_entry)
    updated_entry.update(normalized_fields)
    updated_entry["last_action"] = action
    updated_entry["last_success_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    devices[record_name] = updated_entry
    save_inventory(path, inventory)
    return record_name, path


def build_magic_payload(mac_bytes: bytes) -> bytes:
    return SYNC_BYTES + (mac_bytes * 16)


def build_shutdown_payload(mac_bytes: bytes, extra_bytes: bytes) -> bytes:
    return build_magic_payload(mac_bytes) + extra_bytes


def get_wake_sender():
    try:
        from wakeonlan import send_magic_packet
    except ImportError as exc:
        raise RuntimeError(
            "wake action requires the 'wakeonlan' package. Install it with: python3 -m pip install wakeonlan"
        ) from exc

    return send_magic_packet


def wake_device(broadcast_ip: str, mac: str, port: int, dry_run: bool) -> dict:
    normalized_ip = normalize_host(broadcast_ip)
    normalized_mac = normalize_mac(mac)
    normalized_port = normalize_port(port)
    payload = build_magic_payload(mac_to_bytes(normalized_mac))

    result = {
        "action": "wake",
        "dry_run": dry_run,
        "broadcast_ip": normalized_ip,
        "port": normalized_port,
        "target_mac": normalized_mac,
        "payload_length": len(payload),
        "payload_hex": payload.hex(),
        "transport": "udp-broadcast",
        "library": "wakeonlan",
    }

    if dry_run:
        return result

    send_magic_packet = get_wake_sender()
    send_magic_packet(normalized_mac, ip_address=normalized_ip, port=normalized_port)
    result["sent"] = True
    return result


def shutdown_device(host: str, mac: str, extra_data: str, port: int, dry_run: bool) -> dict:
    normalized_host = normalize_host(host)
    normalized_mac = normalize_mac(mac)
    normalized_extra = normalize_mac(extra_data)
    normalized_port = normalize_port(port)

    payload = build_shutdown_payload(
        mac_to_bytes(normalized_mac),
        mac_to_bytes(normalized_extra),
    )

    result = {
        "action": "shutdown",
        "dry_run": dry_run,
        "host": normalized_host,
        "port": normalized_port,
        "target_mac": normalized_mac,
        "extra_data": normalized_extra,
        "payload_length": len(payload),
        "payload_hex": payload.hex(),
    }

    if dry_run:
        return result

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.sendto(payload, (normalized_host, normalized_port))

    result["sent"] = True
    return result


def list_devices(device_file: str | None) -> dict:
    path = resolve_device_file(device_file)
    inventory = load_inventory(path)
    defaults = inventory.get("defaults", {})
    devices = inventory.get("devices", {})

    resolved_defaults = normalize_inventory_fields(dict(defaults))

    resolved_devices = {}
    for name, entry in devices.items():
        if not isinstance(entry, dict):
            raise ValueError(f"device entry for {name!r} must be an object")

        resolved = dict(resolved_defaults)
        resolved.update(normalize_inventory_fields(entry))

        resolved_devices[name] = resolved

    return {
        "action": "list",
        "device_file": str(path),
        "defaults": resolved_defaults,
        "devices": resolved_devices,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Send WOL-plus wake or shutdown packets from the local machine."
    )
    subparsers = parser.add_subparsers(dest="action", required=True)

    wake_parser = subparsers.add_parser(
        "wake",
        help="Send a WOL magic packet with the wakeonlan Python library.",
    )
    wake_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and print the wake payload details without sending anything.",
    )
    wake_parser.add_argument("--device", help="Device name from the inventory file.")
    wake_parser.add_argument("--device-file", help=f"Inventory JSON file. Default: {DEFAULT_DEVICE_FILE}.")
    wake_parser.add_argument("--mac", help="Target device MAC address.")
    wake_parser.add_argument(
        "--broadcast-ip",
        default=None,
        help=f"Broadcast IPv4 address for wake. Default: {DEFAULT_WAKE_IP}.",
    )
    wake_parser.add_argument(
        "--port",
        type=int,
        default=None,
        help=f"UDP port for the wake packet. Default: {DEFAULT_UDP_PORT}.",
    )

    shutdown_parser = subparsers.add_parser(
        "shutdown",
        help="Send a UDP magic packet to a target IPv4 address.",
    )
    shutdown_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and print the shutdown payload details without sending anything.",
    )
    shutdown_parser.add_argument("--device", help="Device name from the inventory file.")
    shutdown_parser.add_argument("--device-file", help=f"Inventory JSON file. Default: {DEFAULT_DEVICE_FILE}.")
    shutdown_parser.add_argument("--host", help="Target IPv4 address.")
    shutdown_parser.add_argument("--mac", help="Target device MAC address.")
    shutdown_parser.add_argument(
        "--extra-data",
        default=None,
        help=f"6-byte extra data for shutdown packets. Default: {DEFAULT_EXTRA_DATA}.",
    )
    shutdown_parser.add_argument(
        "--port",
        type=int,
        default=None,
        help=f"UDP port for the shutdown packet. Default: {DEFAULT_UDP_PORT}.",
    )

    list_parser = subparsers.add_parser(
        "list",
        help="Print the resolved device inventory.",
    )
    list_parser.add_argument("--device-file", help=f"Inventory JSON file. Default: {DEFAULT_DEVICE_FILE}.")

    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.action == "list":
            result = list_devices(device_file=args.device_file)
        elif args.action == "wake":
            device_entry = {}
            device_file = None
            if args.device:
                device_entry, device_file = resolve_device_entry(args.device, args.device_file)

            mac = prefer(args.mac, device_entry.get("mac"))
            broadcast_ip = prefer(args.broadcast_ip, device_entry.get("broadcast_ip"), DEFAULT_WAKE_IP)
            port = prefer(args.port, device_entry.get("port"), DEFAULT_UDP_PORT)

            if not mac:
                raise ValueError("wake requires --mac or an inventory entry with mac")

            result = wake_device(
                broadcast_ip=broadcast_ip,
                mac=mac,
                port=int(port),
                dry_run=args.dry_run,
            )
            if not args.dry_run:
                recorded_device, recorded_path = update_inventory_record(
                    action="wake",
                    device=args.device,
                    device_file=args.device_file,
                    resolved_path=device_file,
                    fields={
                        "mac": result["target_mac"],
                        "broadcast_ip": result["broadcast_ip"],
                        "port": result["port"],
                    },
                )
                result["device"] = recorded_device
                result["device_file"] = str(recorded_path)
            elif args.device:
                result["device"] = args.device
                result["device_file"] = str(device_file)
        else:
            device_entry = {}
            device_file = None
            if args.device:
                device_entry, device_file = resolve_device_entry(args.device, args.device_file)

            host = prefer(args.host, device_entry.get("host"))
            mac = prefer(args.mac, device_entry.get("mac"))
            extra_data = prefer(args.extra_data, device_entry.get("extra_data"), DEFAULT_EXTRA_DATA)
            port = prefer(args.port, device_entry.get("port"), DEFAULT_UDP_PORT)

            if not host:
                raise ValueError("shutdown requires --host or an inventory entry with host")
            if not mac:
                raise ValueError("shutdown requires --mac or an inventory entry with mac")

            result = shutdown_device(
                host=host,
                mac=mac,
                extra_data=extra_data,
                port=int(port),
                dry_run=args.dry_run,
            )
            if not args.dry_run:
                recorded_device, recorded_path = update_inventory_record(
                    action="shutdown",
                    device=args.device,
                    device_file=args.device_file,
                    resolved_path=device_file,
                    fields={
                        "mac": result["target_mac"],
                        "host": result["host"],
                        "extra_data": result["extra_data"],
                        "port": result["port"],
                    },
                )
                result["device"] = recorded_device
                result["device_file"] = str(recorded_path)
            elif args.device:
                result["device"] = args.device
                result["device_file"] = str(device_file)
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except (RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
