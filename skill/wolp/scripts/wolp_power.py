#!/usr/bin/env python3

import argparse
from datetime import datetime, timezone
import json
import os
import socket
import struct
import sys
from pathlib import Path


DEFAULT_EXTRA_DATA = "FF:FF:FF:FF:FF:FF"
SYNC_BYTES = b"\xff" * 6
ETHERTYPE_WOL = 0x0842
ETH_BROADCAST = "FF:FF:FF:FF:FF:FF"
NET_CLASS_DIR = Path("/sys/class/net")
DEFAULTS = {
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
    if not isinstance(inventory.get("defaults", {}), dict):
        raise ValueError(f"inventory defaults must be an object: {path}")
    if not isinstance(inventory.get("devices", {}), dict):
        raise ValueError(f"inventory devices must be an object: {path}")

    return inventory


def make_default_inventory() -> dict:
    return {"defaults": dict(DEFAULTS), "devices": {}}


def load_or_init_inventory(path: Path) -> dict:
    try:
        inventory = load_inventory(path)
    except ValueError:
        if path.exists():
            raise
        inventory = make_default_inventory()

    inventory.setdefault("defaults", {})
    inventory.setdefault("devices", {})
    return inventory


def resolve_device_file(device_file: str | None) -> Path:
    if device_file:
        return Path(device_file).expanduser().resolve()
    return default_device_file()


def resolve_optional_device_entry(device: str | None, device_file: str | None) -> tuple[dict, Path | None]:
    if not device:
        return {}, None

    path = resolve_device_file(device_file)
    inventory = load_or_init_inventory(path)
    defaults = inventory["defaults"]
    entry = inventory["devices"].get(device)
    if entry is None:
        return {"device": device, **dict(defaults)}, path
    if not isinstance(entry, dict):
        raise ValueError(f"device entry for {device!r} must be an object")

    resolved = dict(defaults)
    resolved.update(entry)
    resolved["device"] = device
    return resolved, path


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
    if "interface" in entry and entry["interface"] is not None:
        normalized["interface"] = normalize_interface(str(entry["interface"]))
    if "extra_data" in entry and entry["extra_data"] is not None:
        normalized["extra_data"] = normalize_mac(str(entry["extra_data"]))
    if "last_action" in entry and entry["last_action"] is not None:
        normalized["last_action"] = str(entry["last_action"])
    if "last_success_at" in entry and entry["last_success_at"] is not None:
        normalized["last_success_at"] = str(entry["last_success_at"])
    return normalized


def find_device_name_by_mac(devices: dict, mac: str) -> str | None:
    for name, entry in devices.items():
        if not isinstance(entry, dict) or entry.get("mac") is None:
            continue
        try:
            if normalize_mac(str(entry["mac"])) == mac:
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
    *, action: str, device: str | None, device_file: str | None, resolved_path: Path | None, fields: dict
) -> tuple[str, Path]:
    path = resolved_path or resolve_device_file(device_file)
    inventory = load_or_init_inventory(path)
    devices = inventory["devices"]
    normalized_fields = normalize_inventory_fields(fields)
    mac = normalized_fields.get("mac")

    record_name = device or (find_device_name_by_mac(devices, mac) if mac else None)
    if record_name is None:
        if mac is None:
            raise ValueError("inventory update requires a mac address")
        record_name = make_device_name(mac)

    existing = devices.get(record_name, {})
    if existing is None:
        existing = {}
    if not isinstance(existing, dict):
        raise ValueError(f"device entry for {record_name!r} must be an object")

    updated = dict(existing)
    updated.update(normalized_fields)
    updated["last_action"] = action
    updated["last_success_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    devices[record_name] = updated
    save_inventory(path, inventory)
    return record_name, path


def build_magic_payload(mac_bytes: bytes) -> bytes:
    return SYNC_BYTES + (mac_bytes * 16)


def get_interface_mac(interface: str) -> str:
    path = NET_CLASS_DIR / normalize_interface(interface) / "address"
    try:
        return normalize_mac(path.read_text(encoding="utf-8").strip())
    except FileNotFoundError as exc:
        raise ValueError(f"network interface {interface!r} not found") from exc


def is_virtual_interface(name: str) -> bool:
    return name.lower().startswith(("br-", "docker", "veth", "virbr", "vmnet", "tailscale", "tun", "tap", "zt", "wg"))


def interface_preference(name: str, operstate: str, mac: str | None) -> tuple[int, bool, str]:
    if name == "lo":
        return 4, False, "loopback interface"
    if is_virtual_interface(name):
        return 3, False, "virtual or bridge interface"
    if operstate == "up" and mac and mac != "00:00:00:00:00:00":
        return 0, True, "preferred for Ethernet frames"
    if operstate == "up":
        return 1, False, "up but missing a usable hardware MAC"
    return 2, False, "interface is not up"


def read_interface_summary(path: Path) -> dict:
    raw_mac = (path / "address").read_text(encoding="utf-8").strip()
    operstate = (path / "operstate").read_text(encoding="utf-8").strip()
    try:
        mac = normalize_mac(raw_mac)
    except ValueError:
        mac = None
    rank, preferred, reason = interface_preference(path.name, operstate, mac)
    return {
        "name": path.name,
        "mac": mac,
        "operstate": operstate,
        "preferred": preferred,
        "preference_reason": reason,
        "preference_rank": rank,
    }


def list_interfaces() -> dict:
    interfaces = [read_interface_summary(path) for path in NET_CLASS_DIR.iterdir() if path.is_dir()]
    interfaces.sort(key=lambda item: (item["preference_rank"], item["name"]))
    return {"action": "list-interfaces", "interfaces": interfaces}


def choose_auto_interface() -> dict:
    for interface in list_interfaces()["interfaces"]:
        if interface["preferred"]:
            return interface
    raise ValueError("no preferred Ethernet interface found; use --list-interfaces and choose an active physical LAN NIC")


def build_ethernet_frame(destination_mac: str, source_mac: str, ethertype: int, payload: bytes) -> bytes:
    return mac_to_bytes(destination_mac) + mac_to_bytes(source_mac) + struct.pack("!H", ethertype) + payload


def send_magic_frame(action: str, interface: str, mac: str, extra_data: str | None, dry_run: bool) -> dict:
    normalized_interface = normalize_interface(interface)
    target_mac = normalize_mac(mac)
    source_mac = get_interface_mac(normalized_interface)
    normalized_extra = normalize_mac(extra_data) if extra_data is not None else None
    payload = build_magic_payload(mac_to_bytes(target_mac))
    if normalized_extra is not None:
        payload += mac_to_bytes(normalized_extra)
    frame = build_ethernet_frame(ETH_BROADCAST, source_mac, ETHERTYPE_WOL, payload)

    result = {
        "action": action,
        "dry_run": dry_run,
        "interface": normalized_interface,
        "source_mac": source_mac,
        "destination_mac": ETH_BROADCAST,
        "ethertype": f"0x{ETHERTYPE_WOL:04x}",
        "target_mac": target_mac,
        "payload_length": len(payload),
        "payload_hex": payload.hex(),
        "frame_length": len(frame),
        "frame_hex": frame.hex(),
        "transport": "ethernet-raw",
        "library": "python-af-packet",
    }
    if normalized_extra is not None:
        result["extra_data"] = normalized_extra
    if dry_run:
        return result

    try:
        with socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(ETHERTYPE_WOL)) as sock:
            sock.bind((normalized_interface, 0))
            sock.send(frame)
    except PermissionError as exc:
        raise RuntimeError(f"{action} requires CAP_NET_RAW or root on Linux to send raw Ethernet frames") from exc
    except AttributeError as exc:
        raise RuntimeError(f"{action} requires Linux AF_PACKET support") from exc

    result["sent"] = True
    return result


def wake_device(interface: str, mac: str, dry_run: bool) -> dict:
    return send_magic_frame("wake", interface, mac, None, dry_run)


def shutdown_device(interface: str, mac: str, extra_data: str, dry_run: bool) -> dict:
    return send_magic_frame("shutdown", interface, mac, extra_data, dry_run)


def list_devices(device_file: str | None) -> dict:
    path = resolve_device_file(device_file)
    inventory = load_or_init_inventory(path)
    defaults = normalize_inventory_fields(dict(inventory["defaults"]))
    devices = {}
    for name, entry in inventory["devices"].items():
        if not isinstance(entry, dict):
            raise ValueError(f"device entry for {name!r} must be an object")
        resolved = dict(defaults)
        resolved.update(normalize_inventory_fields(entry))
        devices[name] = resolved
    return {
        "action": "list",
        "device_file": str(path),
        "device_template": str(DEFAULT_DEVICE_TEMPLATE),
        "defaults": defaults,
        "devices": devices,
    }


def add_ethernet_arguments(parser: argparse.ArgumentParser, *, shutdown: bool) -> None:
    parser.add_argument("--dry-run", action="store_true", help="Build and print frame details without sending anything.")
    if not shutdown:
        parser.add_argument("--list-interfaces", action="store_true", help="List local interfaces and exit.")
    parser.add_argument("--auto-interface", action="store_true", help="Automatically select an active physical LAN interface.")
    parser.add_argument("--device", help="Device name from the inventory file.")
    parser.add_argument("--device-file", help="Inventory JSON file.")
    parser.add_argument("--mac", help="Target device MAC address.")
    parser.add_argument("--interface", help="Network interface used to send the raw Ethernet frame.")
    if shutdown:
        parser.add_argument("--extra-data", help=f"6-byte shutdown discriminator. Default: {DEFAULT_EXTRA_DATA}.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Send WOL-plus wake or shutdown Ethernet frames from the local machine.")
    subparsers = parser.add_subparsers(dest="action", required=True)
    wake_parser = subparsers.add_parser("wake", help="Send a WOL Magic Packet as a raw Ethernet frame on Linux.")
    add_ethernet_arguments(wake_parser, shutdown=False)
    shutdown_parser = subparsers.add_parser("shutdown", help="Send a shutdown Magic Packet as a raw Ethernet frame on Linux.")
    add_ethernet_arguments(shutdown_parser, shutdown=True)
    list_parser = subparsers.add_parser("list", help="Print the resolved device inventory.")
    list_parser.add_argument("--device-file", help="Inventory JSON file.")
    return parser


def resolve_interface(args, device_entry: dict) -> tuple[str, dict | None]:
    if args.auto_interface and args.interface:
        raise ValueError("use either --interface or --auto-interface, not both")
    selected = None
    if args.auto_interface or (args.device and args.interface is None and device_entry.get("interface") is None):
        selected = choose_auto_interface()
    interface = prefer(args.interface, device_entry.get("interface"), selected["name"] if selected else None)
    if not interface:
        raise ValueError("requires --interface, --auto-interface, or an inventory interface")
    return interface, selected


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.action == "list":
            result = list_devices(args.device_file)
        elif args.action == "wake" and args.list_interfaces:
            result = list_interfaces()
        else:
            entry, device_path = resolve_optional_device_entry(args.device, args.device_file)
            mac = prefer(args.mac, entry.get("mac"))
            if not mac:
                raise ValueError(f"{args.action} requires --mac or an inventory entry with mac")
            interface, auto_interface = resolve_interface(args, entry)
            if args.action == "wake":
                result = wake_device(interface, mac, args.dry_run)
            else:
                extra_data = prefer(args.extra_data, entry.get("extra_data"), DEFAULT_EXTRA_DATA)
                result = shutdown_device(interface, mac, extra_data, args.dry_run)

            result["interface_selection"] = "auto" if auto_interface else ("cli" if args.interface else "inventory")
            if auto_interface:
                result["auto_interface"] = auto_interface
            if not args.dry_run:
                fields = {"mac": result["target_mac"], "interface": result["interface"]}
                if args.action == "shutdown":
                    fields["extra_data"] = result["extra_data"]
                record, path = update_inventory_record(
                    action=args.action,
                    device=args.device,
                    device_file=args.device_file,
                    resolved_path=device_path,
                    fields=fields,
                )
                result["device"] = record
                result["device_file"] = str(path)
            elif args.device:
                result["device"] = args.device
                result["device_file"] = str(device_path)

        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (RuntimeError, ValueError) as exc:
        parser.error(str(exc))
        return 2


if __name__ == "__main__":
    sys.exit(main())
