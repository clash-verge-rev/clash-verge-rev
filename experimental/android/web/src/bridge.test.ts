import assert from 'node:assert/strict'
import test from 'node:test'
import { NativeBridge, redact } from './bridge.ts'

test('VPN consent received within the native deadline is not discarded', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let id = ''
  const bridge = new NativeBridge({
    request(json) {
      id = JSON.parse(json).id
    },
  })
  const accepted = assert.doesNotReject(bridge.call('vpn.start', {}))
  context.mock.timers.tick(70_000)
  bridge.receive({ id, result: {} })
  await accepted
})

test('native failure rejects a VPN request instead of reporting a running connection', async () => {
  const bridge = new NativeBridge({
    request(json) {
      const request = JSON.parse(json)
      bridge.receive(
        JSON.stringify({ id: request.id, error: 'VPN permission denied' }),
      )
    },
  })
  await assert.rejects(bridge.call('vpn.start', {}), /VPN permission denied/)
})

test('a synchronous host exception and a missing native reply both reject', async () => {
  const failed = new NativeBridge(
    {
      request() {
        throw new Error('host unavailable')
      },
    },
    15,
  )
  await assert.rejects(failed.call('status', {}), /host unavailable/)
  const silent = new NativeBridge({ request() {} }, 15)
  await assert.rejects(silent.call('vpn.start', {}), /超时/)
})

test('subscription credentials are hidden in displayed messages', () => {
  const output = redact(
    'failed https://user:pass@example.test/private/config?token=abc secret=abcdef',
  )
  assert.equal(output.includes('abc'), false)
  assert.equal(output.includes('user:pass'), false)
  assert.match(output, /https:\/\/example.test\/…/)
  assert.equal(redact('Authorization: Bearer abc123').includes('abc123'), false)
  assert.equal(
    redact('{"password": "quoted-secret"}').includes('quoted-secret'),
    false,
  )
  assert.equal(
    redact('{"authorization":"Bearer bearer-secret"}').includes(
      'bearer-secret',
    ),
    false,
  )
  assert.equal(
    redact('invalid ss://encoded-secret@example.test:443').includes(
      'encoded-secret',
    ),
    false,
  )
})
