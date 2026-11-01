import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const DEFAULT = '114.114.114.114'

test('changing the TUN DNS address preserves per-service backups and external edits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verge-dns-'))
  const bin = path.join(root, 'bin')
  const state = path.join(root, 'state')
  fs.mkdirSync(bin)
  fs.mkdirSync(state)
  fs.writeFileSync(path.join(state, 'primary'), 'wifi')
  fs.writeFileSync(
    path.join(bin, 'scutil'),
    `#!/bin/bash
read -r command key
case "$key" in
  State:*) echo " PrimaryService : $(cat "$DNS_TEST_STATE/primary")" ;;
  Setup:*) echo " UserDefinedName : $(basename "$key")" ;;
esac
`,
    { mode: 0o755 },
  )
  fs.writeFileSync(
    path.join(bin, 'networksetup'),
    `#!/bin/bash
service=$2
case "$1" in
  -getdnsservers)
    if [ "$(cat "$DNS_TEST_STATE/$service")" = empty ]; then
      echo "There aren't any DNS Servers set on $service."
    else
      cat "$DNS_TEST_STATE/$service"
    fi ;;
  -setdnsservers)
    [ "$DNS_TEST_FAIL_SET" = 1 ] && exit 1
    shift 2
    printf '%s\\n' "$@" > "$DNS_TEST_STATE/$service" ;;
esac
`,
    { mode: 0o755 },
  )
  const writeDns = (value, service = 'wifi') =>
    fs.writeFileSync(path.join(state, service), value)
  const readDns = (service = 'wifi') =>
    fs.readFileSync(path.join(state, service), 'utf8').trim()
  const run = (script, address = DEFAULT, fail = false) => {
    const result = spawnSync(
      'bash',
      [path.join(import.meta.dirname, script), address, DEFAULT],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          DNS_TEST_STATE: state,
          DNS_TEST_FAIL_SET: fail ? '1' : '',
        },
        encoding: 'utf8',
      },
    )
    assert.equal(result.status, fail ? 1 : 0, result.stderr)
  }
  const backup = () =>
    fs.readFileSync(path.join(root, '.original_dns/wifi'), 'utf8').trim()

  try {
    writeDns('192.168.1.1\n8.8.8.8')
    run('set_dns.sh')
    run('set_dns.sh', '1.1.1.1')
    assert.equal(readDns(), '1.1.1.1')
    assert.equal(backup(), '192.168.1.1\n8.8.8.8')
    run('set_dns.sh', '1.1.1.1,8.8.4.4')
    assert.equal(readDns(), '1.1.1.1\n8.8.4.4')
    run('set_dns.sh', '9.9.9.9,223.5.5.5')
    assert.equal(readDns(), '9.9.9.9\n223.5.5.5')
    assert.equal(backup(), '192.168.1.1\n8.8.8.8')
    fs.writeFileSync(path.join(state, 'primary'), 'ethernet')
    writeDns('9.9.9.9', 'ethernet')
    run('set_dns.sh', '223.5.5.5')
    run('unset_dns.sh')
    assert.equal(readDns(), '192.168.1.1\n8.8.8.8')
    assert.equal(readDns('ethernet'), '9.9.9.9')
    assert.equal(fs.existsSync(path.join(root, '.original_dns')), false)

    fs.writeFileSync(path.join(state, 'primary'), 'wifi')
    run('set_dns.sh', '1.1.1.1')
    writeDns(`${DEFAULT}\n8.8.4.4`)
    run('set_dns.sh', '223.5.5.5')
    assert.equal(backup(), `${DEFAULT}\n8.8.4.4`)
    run('unset_dns.sh')
    assert.equal(readDns(), `${DEFAULT}\n8.8.4.4`)

    run('set_dns.sh')
    writeDns('8.8.4.4')
    run('unset_dns.sh')
    assert.equal(readDns(), '8.8.4.4')

    run('set_dns.sh', '1.1.1.1,8.8.8.8')
    writeDns('1.1.1.1\n9.9.9.9')
    run('unset_dns.sh')
    assert.equal(readDns(), '1.1.1.1\n9.9.9.9')

    writeDns(DEFAULT)
    fs.writeFileSync(path.join(root, '.original_dns.txt'), '192.168.1.1')
    run('set_dns.sh', '1.1.1.1')
    assert.equal(backup(), '192.168.1.1')
    run('set_dns.sh', '223.5.5.5,8.8.8.8', true)
    run('unset_dns.sh')
    assert.equal(readDns(), '192.168.1.1')

    writeDns(DEFAULT)
    run('set_dns.sh', '1.1.1.1')
    run('unset_dns.sh')
    assert.equal(readDns(), 'empty')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
