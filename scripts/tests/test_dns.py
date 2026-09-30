import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]


class DNSRecovery(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = {'route': 'en0', 'dns': {'Wi-Fi': '10.10.0.53', 'Ethernet': '192.168.50.1'}}
        self.save()
        mock = self.root / 'networksetup'
        mock.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
p = Path(os.environ['MOCK_STATE'])
s = json.loads(p.read_text())
a = sys.argv[1:]
if a[0] == '-listnetworkserviceorder':
    print('(1) Wi-Fi\\n(Hardware Port: Wi-Fi, Device: en0)\\n(2) Ethernet\\n(Hardware Port: Ethernet, Device: en1)')
elif a[0] == '-getdnsservers':
    value = s['dns'][a[1]]
    print("There aren't any DNS Servers set on " + a[1] if value == 'empty' else value)
elif a[0] == '-setdnsservers':
    if s.get('fail'): sys.exit(1)
    s['dns'][a[1]] = '\\n'.join(a[2:])
    p.write_text(json.dumps(s))
else: sys.exit(2)
''')
        mock.chmod(0o755)
        route = self.root / 'route'
        route.write_text('''#!/usr/bin/env python3
import os,json
print('interface: ' + json.load(open(os.environ['MOCK_STATE']))['route'])
''')
        route.chmod(0o755)
        scutil = self.root / 'scutil'
        scutil.write_text('''#!/usr/bin/env python3
import sys, os, json
state = json.load(open(os.environ['MOCK_STATE']))
request = sys.stdin.read()
if request.startswith('list '):
    print('subKey [0] = Setup:/Network/Service/wifi-id\\nsubKey [1] = Setup:/Network/Service/ethernet-id')
else:
    wifi = '/wifi-id' in request
    if '/Interface' in request:
        print('  DeviceName : ' + ('en0' if wifi else 'en1'))
    else:
        print('  UserDefinedName : ' + (state.get('wifi_name', 'Wi-Fi') if wifi else 'Ethernet'))
''')
        scutil.chmod(0o755)
        self.env = dict(os.environ, PATH=f'{self.root}:' + os.environ['PATH'], MOCK_STATE=str(self.root / 'mock.json'))

    def save(self):
        (self.root / 'mock.json').write_text(json.dumps(self.state))

    def run_script(self, restore=False, success=True):
        args = ['bash', str(SCRIPTS / ('unset_dns.sh' if restore else 'set_dns.sh'))]
        if not restore:
            args.append('114.114.114.114')
        result = subprocess.run(args, cwd=self.root, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, success, result.stderr)
        self.state = json.loads((self.root / 'mock.json').read_text())

    def test_network_switch_restores_original_service(self):
        self.run_script()
        self.state['route'] = 'en1'
        self.save()
        self.run_script(restore=True)
        self.assertEqual(self.state['dns'], {'Wi-Fi': '10.10.0.53', 'Ethernet': '192.168.50.1'})

    def test_renamed_service_restores_by_uuid(self):
        self.run_script()
        self.state['wifi_name'] = 'Renamed Wi-Fi'
        self.state['dns']['Renamed Wi-Fi'] = self.state['dns'].pop('Wi-Fi')
        self.save()
        self.run_script(restore=True)
        self.assertEqual(self.state['dns']['Renamed Wi-Fi'], '10.10.0.53')

    def test_failed_restore_preserves_backup_and_retries(self):
        self.run_script()
        self.state['fail'] = True
        self.save()
        self.run_script(restore=True, success=False)
        self.assertEqual(len(list((self.root / '.dns-state').glob('*.dns'))), 1)
        self.state['fail'] = False
        self.save()
        self.run_script(restore=True)
        self.assertEqual(self.state['dns']['Wi-Fi'], '10.10.0.53')

    def test_repeated_apply_preserves_original_and_dhcp(self):
        self.state['dns']['Wi-Fi'] = 'empty'
        self.save()
        self.run_script()
        self.run_script()
        self.run_script(restore=True)
        self.assertEqual(self.state['dns']['Wi-Fi'], 'empty')

    def test_external_edit_is_preserved(self):
        self.run_script()
        self.state['dns']['Wi-Fi'] = '9.9.9.9'
        self.save()
        self.run_script(restore=True, success=False)
        self.assertEqual(self.state['dns']['Wi-Fi'], '9.9.9.9')

    def test_both_network_services_restore(self):
        self.run_script()
        self.state['route'] = 'en1'
        self.save()
        self.run_script()
        self.run_script(restore=True)
        self.assertEqual(self.state['dns'], {'Wi-Fi': '10.10.0.53', 'Ethernet': '192.168.50.1'})


if __name__ == '__main__':
    unittest.main()
