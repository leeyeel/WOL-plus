from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parent.parent / "skill" / "wolp" / "scripts" / "wolp_power.py"
SPEC = importlib.util.spec_from_file_location("wolp_power", MODULE_PATH)
WOLP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WOLP)


class WolpPowerTests(unittest.TestCase):
    def test_device_file_honors_environment_override(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "devices.json"
            with patch.dict(os.environ, {"WOLP_DEVICE_FILE": str(target)}, clear=False):
                self.assertEqual(WOLP.default_device_file(), target.resolve())

    def test_list_initializes_ethernet_defaults(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "devices.json"
            result = WOLP.list_devices(str(target))

        self.assertEqual(result["defaults"], WOLP.DEFAULTS)
        self.assertEqual(result["devices"], {})

    def test_wake_dry_run_builds_standard_raw_ethernet_frame(self):
        with patch.object(WOLP, "get_interface_mac", return_value="11:22:33:44:55:66"):
            result = WOLP.wake_device("eth0", "AA:BB:CC:DD:EE:FF", dry_run=True)

        self.assertEqual(result["transport"], "ethernet-raw")
        self.assertEqual(result["payload_length"], 102)
        self.assertEqual(result["frame_length"], 116)
        self.assertNotIn("extra_data", result)

    def test_shutdown_dry_run_appends_discriminator_to_raw_ethernet_frame(self):
        with patch.object(WOLP, "get_interface_mac", return_value="11:22:33:44:55:66"):
            result = WOLP.shutdown_device(
                "eth0", "AA:BB:CC:DD:EE:FF", "12:34:56:78:9A:BC", dry_run=True
            )

        self.assertEqual(result["transport"], "ethernet-raw")
        self.assertEqual(result["extra_data"], "12:34:56:78:9A:BC")
        self.assertEqual(result["payload_length"], 108)
        self.assertEqual(result["frame_length"], 122)
        self.assertTrue(result["payload_hex"].endswith("123456789abc"))

    def test_real_shutdown_uses_raw_ethernet_socket(self):
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
                result = WOLP.shutdown_device(
                    "eth0", "AA:BB:CC:DD:EE:FF", "12:34:56:78:9A:BC", dry_run=False
                )

        self.assertTrue(result["sent"])
        self.assertEqual(sent["family"], WOLP.socket.AF_PACKET)
        self.assertEqual(sent["socktype"], WOLP.socket.SOCK_RAW)
        self.assertEqual(sent["protocol"], WOLP.socket.htons(WOLP.ETHERTYPE_WOL))
        self.assertEqual(sent["bind"], ("eth0", 0))
        self.assertEqual(len(sent["payload"]), 122)

    def test_update_inventory_records_raw_shutdown_fields(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "devices.json"
            record_name, record_path = WOLP.update_inventory_record(
                action="shutdown",
                device="nas",
                device_file=str(target),
                resolved_path=None,
                fields={
                    "mac": "AA:BB:CC:DD:EE:FF",
                    "interface": "eth0",
                    "extra_data": "12:34:56:78:9A:BC",
                },
            )
            inventory = json.loads(target.read_text(encoding="utf-8"))

        self.assertEqual(record_name, "nas")
        self.assertEqual(record_path, target.resolve())
        self.assertEqual(inventory["devices"]["nas"]["extra_data"], "12:34:56:78:9A:BC")
        self.assertEqual(inventory["devices"]["nas"]["last_action"], "shutdown")

    def test_list_interfaces_prefers_active_physical_interface(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            net_dir = Path(tmpdir)
            for name, mac, state in (("eno1", "11:22:33:44:55:66", "up"), ("lo", "00:00:00:00:00:00", "unknown")):
                iface = net_dir / name
                iface.mkdir()
                (iface / "address").write_text(mac + "\n", encoding="utf-8")
                (iface / "operstate").write_text(state + "\n", encoding="utf-8")
            with patch.object(WOLP, "NET_CLASS_DIR", net_dir):
                result = WOLP.list_interfaces()

        self.assertEqual([item["name"] for item in result["interfaces"]], ["eno1", "lo"])
        self.assertTrue(result["interfaces"][0]["preferred"])

    def test_shutdown_cli_uses_inventory_interface_and_discriminator(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "devices.json"
            target.write_text(json.dumps({"defaults": WOLP.DEFAULTS, "devices": {"nas": {
                "mac": "AA:BB:CC:DD:EE:FF", "interface": "eth0", "extra_data": "12:34:56:78:9A:BC"
            }}}), encoding="utf-8")
            with patch.object(WOLP, "get_interface_mac", return_value="11:22:33:44:55:66"):
                with redirect_stdout(io.StringIO()):
                    exit_code = WOLP.main(["shutdown", "--device", "nas", "--device-file", str(target), "--dry-run"])

        self.assertEqual(exit_code, 0)


if __name__ == "__main__":
    unittest.main()
