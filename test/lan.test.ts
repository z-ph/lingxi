import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LanAddressError,
  allowedHostHeaders,
  assertBindableAddress,
  formatHostForUrl,
  isAllowedPeerAddress,
  isBindableAddress,
  isLoopbackAddress,
  isPrivateIPv4,
  resolveLanAddress,
  stripScopeAndMapping,
} from '../src/lan.js';
import type { NetworkInterfacesLike } from '../src/lan.js';

test('private IPv4 detection follows RFC1918', () => {
  assert.equal(isPrivateIPv4('10.0.0.1'), true);
  assert.equal(isPrivateIPv4('10.255.255.255'), true);
  assert.equal(isPrivateIPv4('172.16.0.1'), true);
  assert.equal(isPrivateIPv4('172.31.255.255'), true);
  assert.equal(isPrivateIPv4('172.15.0.1'), false);
  assert.equal(isPrivateIPv4('172.32.0.1'), false);
  assert.equal(isPrivateIPv4('192.168.1.5'), true);
  assert.equal(isPrivateIPv4('192.169.1.5'), false);
  assert.equal(isPrivateIPv4('8.8.8.8'), false);
  assert.equal(isPrivateIPv4('not-an-ip'), false);
});

test('loopback and mapped addresses', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.255.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.1'), false);
  assert.equal(stripScopeAndMapping('::ffff:192.168.1.4'), '192.168.1.4');
  assert.equal(stripScopeAndMapping('fe80::1%wlan0'), 'fe80::1');
});

test('only LAN/loopback peers are allowed', () => {
  assert.equal(isAllowedPeerAddress('127.0.0.1'), true);
  assert.equal(isAllowedPeerAddress('192.168.1.20'), true);
  assert.equal(isAllowedPeerAddress('::ffff:192.168.1.20'), true);
  assert.equal(isAllowedPeerAddress('fd00::1'), true);
  assert.equal(isAllowedPeerAddress('fe80::1%wlan0'), true);
  assert.equal(isAllowedPeerAddress('8.8.8.8'), false);
  assert.equal(isAllowedPeerAddress('2001:db8::1'), false);
  assert.equal(isAllowedPeerAddress('0.0.0.0'), false);
  assert.equal(isAllowedPeerAddress(undefined), false);
});

test('binding refuses wildcard, public and IPv6 addresses', () => {
  assert.equal(isBindableAddress('127.0.0.1'), true);
  assert.equal(isBindableAddress('192.168.1.5'), true);
  assert.equal(isBindableAddress('0.0.0.0'), false);
  assert.equal(isBindableAddress('8.8.8.8'), false);
  assert.equal(isBindableAddress('::1'), false);
  assert.throws(() => assertBindableAddress('0.0.0.0'), LanAddressError);
  assert.throws(() => assertBindableAddress('8.8.8.8'), LanAddressError);
  assert.doesNotThrow(() => assertBindableAddress('10.1.2.3'));
});

test('resolveLanAddress prefers Wi-Fi over virtual bridges and Ethernet', () => {
  const interfaces: NetworkInterfacesLike = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
    eth0: [{ address: '10.0.0.5', family: 'IPv4', internal: false }],
    wlan0: [{ address: '192.168.1.5', family: 'IPv4', internal: false }],
    'br-1234': [{ address: '172.18.0.1', family: 'IPv4', internal: false }],
  };
  assert.equal(resolveLanAddress(interfaces), '192.168.1.5');
});

test('resolveLanAddress ignores link-local and fails closed without a LAN address', () => {
  assert.throws(
    () =>
      resolveLanAddress({
        wlan0: [
          { address: '169.254.10.20', family: 'IPv4', internal: false },
          { address: 'fe80::1', family: 'IPv6', internal: false },
        ],
      }),
    LanAddressError,
  );
});

test('allowedHostHeaders accepts the bound host and localhost only for loopback', () => {
  assert.deepEqual(
    [...allowedHostHeaders('127.0.0.1', 8765)].sort(),
    ['127.0.0.1:8765', 'localhost:8765', '[::1]:8765'].sort(),
  );
  assert.deepEqual([...allowedHostHeaders('192.168.1.5', 8765)], ['192.168.1.5:8765']);
  assert.equal(formatHostForUrl('192.168.1.5'), '192.168.1.5');
});
