from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parent.parent / "skill" / "wolp" / "scripts" / "wolp_power.py"
SPEC = spec_from_file_location("wolp_power", MODULE_PATH)
WOLP = module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(WOLP)


class WolpPowerTests(unittest.TestCase):
    def test_default_device_file_prefers_environment_override(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "custom-devices.json"
            with patch.dict(os.environ, {"WOLP_DEVICE_FILE": str(target)}, clear=False):
                self.assertEqual(WOLP.default_device_file(), target.resolve())

    def test_list_devices_uses_default_inventory_for_missing_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "devices.json"
            with patch.dict(os.environ, {"WOLP_DEVICE_FILE": str(target)}, clear=False):
                result = WOLP.list_devices(device_file=None)

            self.assertEqual(result["device_file"], str(target.resolve()))
            self.assertEqual(result["device_template"], str(WOLP.DEFAULT_DEVICE_TEMPLATE))
            self.assertEqual(
                result["defaults"],
                {
                    "extra_data": "FF:FF:FF:FF:FF:FF",
                    "port": 9,
                },
            )
            self.assertEqual(result["devices"], {})
            self.assertFalse(target.exists())

    def test_wake_device_dry_run_reports_raw_ethernet_transport(self):
        with patch.object(WOLP, "get_interface_mac", return_value="11:22:33:44:55:66"):
            result = WOLP.wake_device("eth0", "AA:BB:CC:DD:EE:FF", dry_run=True)

        self.assertEqual(result["library"], "python-af-packet")
        self.assertEqual(result["transport"], "ethernet-raw")
        self.assertEqual(result["interface"], "eth0")
        self.assertEqual(result["source_mac"], "11:22:33:44:55:66")
        self.assertEqual(result["destination_mac"], "FF:FF:FF:FF:FF:FF")
        self.assertEqual(result["ethertype"], "0x0842")
        self.assertEqual(result["payload_length"], 102)
        self.assertEqual(result["frame_length"], 116)
        self.assertEqual(result["target_mac"], "AA:BB:CC:DD:EE:FF")

    def test_shutdown_device_dry_run_builds_wol_plus_payload(self):
        result = WOLP.shutdown_device(
            host="192.168.1.50",
            mac="AA:BB:CC:DD:EE:FF",
            extra_data="11:22:33:44:55:66",
            port=9,
            dry_run=True,
        )

        self.assertEqual(result["payload_length"], 108)
        self.assertEqual(result["extra_data"], "11:22:33:44:55:66")
        self.assertEqual(result["host"], "192.168.1.50")

    def test_list_interfaces_returns_local_interfaces(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            net_dir = Path(tmpdir)
            for name, mac, operstate in (
                ("eno1", "11:22:33:44:55:66", "up"),
                ("lo", "00:00:00:00:00:00", "unknown"),
            ):
                iface_dir = net_dir / name
                iface_dir.mkdir()
                (iface_dir / "address").write_text(mac + "\n", encoding="utf-8")
                (iface_dir / "operstate").write_text(operstate + "\n", encoding="utf-8")

            with patch.object(WOLP, "NET_CLASS_DIR", net_dir):
                result = WOLP.list_interfaces()

        self.assertEqual(result["action"], "list-interfaces")
        self.assertEqual(
            result["interfaces"],
            [
                {
                    "name": "eno1",
                    "mac": "11:22:33:44:55:66",
                    "operstate": "up",
                    "preferred": True,
                    "preference_rank": 0,
                    "preference_reason": "preferred for wake",
                },
                {
                    "name": "lo",
                    "mac": "00:00:00:00:00:00",
                    "operstate": "unknown",
                    "preferred": False,
                    "preference_rank": 4,
                    "preference_reason": "loopback interface",
                },
            ],
        )

    def test_list_interfaces_tolerates_non_mac_addresses(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            net_dir = Path(tmpdir)
            iface_dir = net_dir / "tun0"
            iface_dir.mkdir()
            (iface_dir / "address").write_text("\n", encoding="utf-8")
            (iface_dir / "operstate").write_text("unknown\n", encoding="utf-8")

            with patch.object(WOLP, "NET_CLASS_DIR", net_dir):
                result = WOLP.list_interfaces()

        self.assertEqual(
            result["interfaces"],
            [
                {
                    "name": "tun0",
                    "mac": None,
                    "operstate": "unknown",
                    "preferred": False,
                    "preference_rank": 3,
                    "preference_reason": "virtual or bridge interface",
                }
            ],
        )

    def test_list_interfaces_sorts_preferred_before_virtual_and_loopback(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            net_dir = Path(tmpdir)
            for name, mac, operstate in (
                ("br-test", "11:11:11:11:11:11", "up"),
                ("eno1", "22:22:22:22:22:22", "up"),
                ("lo", "00:00:00:00:00:00", "unknown"),
                ("wlp6s0", "33:33:33:33:33:33", "down"),
            ):
                iface_dir = net_dir / name
                iface_dir.mkdir()
                (iface_dir / "address").write_text(mac + "\n", encoding="utf-8")
                (iface_dir / "operstate").write_text(operstate + "\n", encoding="utf-8")

            with patch.object(WOLP, "NET_CLASS_DIR", net_dir):
                result = WOLP.list_interfaces()

        self.assertEqual(
            [item["name"] for item in result["interfaces"]],
            ["eno1", "wlp6s0", "br-test", "lo"],
        )

    def test_choose_auto_interface_returns_first_preferred_interface(self):
        with patch.object(
            WOLP,
            "list_interfaces",
            return_value={
                "action": "list-interfaces",
                "interfaces": [
                    {
                        "name": "eno1",
                        "mac": "11:22:33:44:55:66",
                        "operstate": "up",
                        "preferred": True,
                        "preference_rank": 0,
                        "preference_reason": "preferred for wake",
                    },
                    {
                        "name": "br-test",
                        "mac": "22:22:22:22:22:22",
                        "operstate": "up",
                        "preferred": False,
                        "preference_rank": 3,
                        "preference_reason": "virtual or bridge interface",
                    },
                ],
            },
        ):
            result = WOLP.choose_auto_interface()

        self.assertEqual(result["name"], "eno1")

    def test_choose_auto_interface_raises_when_no_preferred_interface_exists(self):
        with patch.object(
            WOLP,
            "list_interfaces",
            return_value={
                "action": "list-interfaces",
                "interfaces": [
                    {
                        "name": "lo",
                        "mac": "00:00:00:00:00:00",
                        "operstate": "unknown",
                        "preferred": False,
                        "preference_rank": 4,
                        "preference_reason": "loopback interface",
                    }
                ],
            },
        ):
            with self.assertRaisesRegex(ValueError, "no preferred wake interface found"):
                WOLP.choose_auto_interface()

    def test_wake_device_real_send_uses_raw_ethernet_socket(self):
        sent = {}

        class FakeSocket:
            def __init__(self, family, socktype, protocol):
                sent["family"] = family
                sent["socktype"] = socktype
                sent["protocol"] = protocol

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def bind(self, addr):
                sent["bind"] = addr

            def send(self, payload):
                sent["payload"] = payload

        with patch.object(WOLP, "get_interface_mac", return_value="11:22:33:44:55:66"):
            with patch.object(WOLP.socket, "socket", FakeSocket):
                result = WOLP.wake_device("eth0", "AA:BB:CC:DD:EE:FF", dry_run=False)

        self.assertTrue(result["sent"])
        self.assertEqual(sent["family"], WOLP.socket.AF_PACKET)
        self.assertEqual(sent["socktype"], WOLP.socket.SOCK_RAW)
        self.assertEqual(sent["protocol"], WOLP.socket.htons(WOLP.ETHERTYPE_WOL))
        self.assertEqual(sent["bind"], ("eth0", 0))
        self.assertEqual(len(sent["payload"]), 116)

    def test_update_inventory_record_writes_user_scoped_inventory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "devices.json"

            record_name, record_path = WOLP.update_inventory_record(
                action="shutdown",
                device="nas",
                device_file=str(target),
                resolved_path=None,
                fields={
                    "mac": "AA:BB:CC:DD:EE:FF",
                    "host": "192.168.1.50",
                    "extra_data": "11:22:33:44:55:66",
                    "port": 9,
                },
            )

            self.assertEqual(record_name, "nas")
            self.assertEqual(record_path, target.resolve())

            inventory = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(inventory["defaults"], WOLP.DEFAULTS)
            self.assertEqual(inventory["devices"]["nas"]["mac"], "AA:BB:CC:DD:EE:FF")
            self.assertEqual(inventory["devices"]["nas"]["host"], "192.168.1.50")
            self.assertEqual(inventory["devices"]["nas"]["last_action"], "shutdown")

    def test_named_device_can_be_used_before_inventory_entry_exists(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "devices.json"
            argv = [
                "wake",
                "--device",
                "nas",
                "--device-file",
                str(target),
                "--mac",
                "AA:BB:CC:DD:EE:FF",
                "--interface",
                "eth0",
                "--dry-run",
            ]

            with patch.object(WOLP, "get_interface_mac", return_value="11:22:33:44:55:66"):
                exit_code = WOLP.main(argv)

            self.assertEqual(exit_code, 0)

    def test_wake_list_interfaces_exits_without_mac_or_interface(self):
        with patch.object(
            WOLP,
            "list_interfaces",
            return_value={
                "action": "list-interfaces",
                "interfaces": [
                    {
                        "name": "eno1",
                        "mac": "11:22:33:44:55:66",
                        "operstate": "up",
                        "preferred": True,
                        "preference_rank": 0,
                        "preference_reason": "preferred for wake",
                    }
                ],
            },
        ):
            exit_code = WOLP.main(["wake", "--list-interfaces"])

        self.assertEqual(exit_code, 0)

    def test_wake_auto_interface_uses_selected_interface(self):
        with patch.object(
            WOLP,
            "choose_auto_interface",
            return_value={
                "name": "eno1",
                "mac": "11:22:33:44:55:66",
                "operstate": "up",
                "preferred": True,
                "preference_rank": 0,
                "preference_reason": "preferred for wake",
            },
        ):
            with patch.object(WOLP, "get_interface_mac", return_value="11:22:33:44:55:66"):
                exit_code = WOLP.main(
                    ["wake", "--auto-interface", "--mac", "AA:BB:CC:DD:EE:FF", "--dry-run"]
                )

        self.assertEqual(exit_code, 0)

    def test_wake_rejects_interface_and_auto_interface_together(self):
        exit_code = WOLP.main(
            ["wake", "--interface", "eno1", "--auto-interface", "--mac", "AA:BB:CC:DD:EE:FF", "--dry-run"]
        )

        self.assertEqual(exit_code, 2)

    def test_wake_device_auto_selects_interface_when_inventory_entry_has_no_interface(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "devices.json"
            target.write_text(
                json.dumps(
                    {
                        "defaults": {"port": 9, "extra_data": "FF:FF:FF:FF:FF:FF"},
                        "devices": {
                            "nas": {
                                "mac": "AA:BB:CC:DD:EE:FF",
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            with patch.object(
                WOLP,
                "choose_auto_interface",
                return_value={
                    "name": "eno1",
                    "mac": "11:22:33:44:55:66",
                    "operstate": "up",
                    "preferred": True,
                    "preference_rank": 0,
                    "preference_reason": "preferred for wake",
                },
            ):
                with patch.object(WOLP, "get_interface_mac", return_value="11:22:33:44:55:66"):
                    exit_code = WOLP.main(
                        ["wake", "--device", "nas", "--device-file", str(target), "--dry-run"]
                    )

        self.assertEqual(exit_code, 0)

    def test_wake_device_uses_inventory_interface_without_auto_selection(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "devices.json"
            target.write_text(
                json.dumps(
                    {
                        "defaults": {"port": 9, "extra_data": "FF:FF:FF:FF:FF:FF"},
                        "devices": {
                            "nas": {
                                "mac": "AA:BB:CC:DD:EE:FF",
                                "interface": "eno1",
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            with patch.object(WOLP, "choose_auto_interface") as choose_auto_interface:
                with patch.object(WOLP, "get_interface_mac", return_value="11:22:33:44:55:66"):
                    exit_code = WOLP.main(
                        ["wake", "--device", "nas", "--device-file", str(target), "--dry-run"]
                    )

            choose_auto_interface.assert_not_called()

        self.assertEqual(exit_code, 0)


if __name__ == "__main__":
    unittest.main()
