#!/usr/bin/env python3

import argparse
from datetime import datetime, timezone
import ipaddress
import json
import os
import socket
import struct
import sys
from pathlib import Path


DEFAULT_EXTRA_DATA = "FF:FF:FF:FF:FF:FF"
DEFAULT_UDP_PORT = 9
SYNC_BYTES = b"\xff" * 6
ETHERTYPE_WOL = 0x0842
ETH_BROADCAST = "FF:FF:FF:FF:FF:FF"
NET_CLASS_DIR = Path("/sys/class/net")
DEFAULTS = {
    "port": DEFAULT_UDP_PORT,
    "extra_data": DEFAULT_EXTRA_DATA,
}
SKILL_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DEVICE_TEMPLATE = SKILL_DIR / "assets" / "devices.example.json"


def default_device_file() -> Path:
    override = os.environ.get("WOLP_DEVICE_FILE")
    if override:
        return Path(override).expanduser().resolve()

    config_home = os.environ.get("XDG_CONFIG_HOME")
    if config_home:
        return Path(config_home).expanduser().resolve() / "wolp" / "devices.json"

    return Path.home() / ".config" / "wolp" / "devices.json"


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


def normalize_interface(value: str) -> str:
    interface = value.strip()
    if not interface:
        raise ValueError("invalid network interface")
    return interface


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


def make_default_inventory() -> dict:
    return {
        "defaults": dict(DEFAULTS),
        "devices": {},
    }


def load_or_init_inventory(path: Path) -> dict:
    try:
        inventory = load_inventory(path)
    except ValueError as exc:
        if path.exists():
            raise
        inventory = make_default_inventory()

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
    return default_device_file()


def resolve_device_entry(device: str, device_file: str | None) -> tuple[dict, Path]:
    path = resolve_device_file(device_file)
    inventory = load_or_init_inventory(path)
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


def resolve_optional_device_entry(device: str | None, device_file: str | None) -> tuple[dict, Path | None]:
    if not device:
        return {}, None

    path = resolve_device_file(device_file)
    inventory = load_or_init_inventory(path)
    defaults = inventory.get("defaults", {})
    devices = inventory.get("devices", {})

    entry = devices.get(device)
    if entry is None:
        return {"device": device, **dict(defaults)}, path
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
    if "interface" in entry and entry["interface"] is not None:
        normalized["interface"] = normalize_interface(str(entry["interface"]))
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


def get_interface_mac(interface: str) -> str:
    path = NET_CLASS_DIR / normalize_interface(interface) / "address"
    try:
        return normalize_mac(path.read_text(encoding="utf-8").strip())
    except FileNotFoundError as exc:
        raise ValueError(f"network interface {interface!r} not found") from exc


def is_virtual_interface(name: str) -> bool:
    lowered = name.lower()
    virtual_prefixes = (
        "br-",
        "docker",
        "veth",
        "virbr",
        "vmnet",
        "tailscale",
        "tun",
        "tap",
        "zt",
        "wg",
    )
    return lowered.startswith(virtual_prefixes)


def interface_preference(name: str, operstate: str, mac: str | None) -> tuple[int, bool, str]:
    if name == "lo":
        return 4, False, "loopback interface"
    if is_virtual_interface(name):
        return 3, False, "virtual or bridge interface"
    if operstate == "up" and mac and mac != "00:00:00:00:00:00":
        return 0, True, "preferred for wake"
    if operstate == "up":
        return 1, False, "up but missing a usable hardware MAC"
    return 2, False, "interface is not up"


def read_interface_summary(path: Path) -> dict:
    name = path.name
    raw_mac = (path / "address").read_text(encoding="utf-8").strip()
    operstate = (path / "operstate").read_text(encoding="utf-8").strip()

    try:
        mac = normalize_mac(raw_mac)
    except ValueError:
        mac = None

    rank, preferred, reason = interface_preference(name, operstate, mac)

    return {
        "name": name,
        "mac": mac,
        "operstate": operstate,
        "preferred": preferred,
        "preference_reason": reason,
        "preference_rank": rank,
    }


def list_interfaces() -> dict:
    interfaces = []
    net_dir = NET_CLASS_DIR

    for path in sorted(net_dir.iterdir(), key=lambda item: item.name):
        if not path.is_dir():
            continue

        interfaces.append(read_interface_summary(path))

    interfaces.sort(key=lambda item: (item["preference_rank"], item["name"]))

    return {
        "action": "list-interfaces",
        "interfaces": interfaces,
    }


def choose_auto_interface() -> dict:
    interfaces = list_interfaces()["interfaces"]
    for interface in interfaces:
        if interface["preferred"]:
            return interface

    raise ValueError(
        "no preferred wake interface found; run 'wake --list-interfaces' and choose an operstate=up physical LAN NIC"
    )


def build_ethernet_frame(destination_mac: str, source_mac: str, ethertype: int, payload: bytes) -> bytes:
    return (
        mac_to_bytes(destination_mac)
        + mac_to_bytes(source_mac)
        + struct.pack("!H", ethertype)
        + payload
    )


def wake_device(interface: str, mac: str, dry_run: bool) -> dict:
    normalized_interface = normalize_interface(interface)
    normalized_mac = normalize_mac(mac)
    source_mac = get_interface_mac(normalized_interface)
    payload = build_magic_payload(mac_to_bytes(normalized_mac))
    frame = build_ethernet_frame(ETH_BROADCAST, source_mac, ETHERTYPE_WOL, payload)

    result = {
        "action": "wake",
        "dry_run": dry_run,
        "interface": normalized_interface,
        "source_mac": source_mac,
        "destination_mac": ETH_BROADCAST,
        "ethertype": f"0x{ETHERTYPE_WOL:04x}",
        "target_mac": normalized_mac,
        "payload_length": len(payload),
        "payload_hex": payload.hex(),
        "frame_length": len(frame),
        "frame_hex": frame.hex(),
        "transport": "ethernet-raw",
        "library": "python-af-packet",
    }

    if dry_run:
        return result

    try:
        with socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(ETHERTYPE_WOL)) as sock:
            sock.bind((normalized_interface, 0))
            sock.send(frame)
    except PermissionError as exc:
        raise RuntimeError(
            "wake action requires CAP_NET_RAW or root on Linux to send raw Ethernet frames"
        ) from exc
    except AttributeError as exc:
        raise RuntimeError("wake action requires Linux AF_PACKET support") from exc

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
    inventory = load_or_init_inventory(path)
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
        "device_template": str(DEFAULT_DEVICE_TEMPLATE),
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
        help="Send a WOL magic packet as a raw Ethernet frame on Linux.",
    )
    wake_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and print the wake payload details without sending anything.",
    )
    wake_parser.add_argument(
        "--list-interfaces",
        action="store_true",
        help="List available local network interfaces for raw Ethernet wake and exit.",
    )
    wake_parser.add_argument(
        "--auto-interface",
        action="store_true",
        help="Automatically select the best local interface for raw Ethernet wake.",
    )
    wake_parser.add_argument("--device", help="Device name from the inventory file.")
    wake_parser.add_argument(
        "--device-file",
        help=(
            "Inventory JSON file. Default: WOLP_DEVICE_FILE, "
            "XDG_CONFIG_HOME/wolp/devices.json, or ~/.config/wolp/devices.json."
        ),
    )
    wake_parser.add_argument("--mac", help="Target device MAC address.")
    wake_parser.add_argument(
        "--interface",
        default=None,
        help="Network interface used to send the raw Ethernet WOL frame.",
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
    shutdown_parser.add_argument(
        "--device-file",
        help=(
            "Inventory JSON file. Default: WOLP_DEVICE_FILE, "
            "XDG_CONFIG_HOME/wolp/devices.json, or ~/.config/wolp/devices.json."
        ),
    )
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
    list_parser.add_argument(
        "--device-file",
        help=(
            "Inventory JSON file. Default: WOLP_DEVICE_FILE, "
            "XDG_CONFIG_HOME/wolp/devices.json, or ~/.config/wolp/devices.json."
        ),
    )

    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.action == "list":
            result = list_devices(device_file=args.device_file)
        elif args.action == "wake":
            if args.list_interfaces:
                result = list_interfaces()
                print(json.dumps(result, indent=2, sort_keys=True))
                return 0

            if args.auto_interface and args.interface:
                raise ValueError("wake accepts either --interface or --auto-interface, not both")

            device_entry, device_file = resolve_optional_device_entry(args.device, args.device_file)

            mac = prefer(args.mac, device_entry.get("mac"))
            auto_interface = None
            if args.auto_interface or (args.device and args.interface is None and device_entry.get("interface") is None):
                auto_interface = choose_auto_interface()
            interface = prefer(args.interface, device_entry.get("interface"))
            if interface is None and auto_interface is not None:
                interface = auto_interface["name"]

            if not mac:
                raise ValueError("wake requires --mac or an inventory entry with mac")
            if not interface:
                raise ValueError("wake requires --interface or an inventory entry with interface")

            result = wake_device(
                interface=interface,
                mac=mac,
                dry_run=args.dry_run,
            )
            if auto_interface is not None:
                result["auto_interface"] = auto_interface
                result["interface_selection"] = "auto"
            elif args.interface is not None:
                result["interface_selection"] = "cli"
            elif device_entry.get("interface") is not None:
                result["interface_selection"] = "inventory"
            if not args.dry_run:
                recorded_device, recorded_path = update_inventory_record(
                    action="wake",
                    device=args.device,
                    device_file=args.device_file,
                    resolved_path=device_file,
                    fields={
                        "mac": result["target_mac"],
                        "interface": result["interface"],
                    },
                )
                result["device"] = recorded_device
                result["device_file"] = str(recorded_path)
            elif args.device:
                result["device"] = args.device
                result["device_file"] = str(device_file)
        else:
            device_entry, device_file = resolve_optional_device_entry(args.device, args.device_file)

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
