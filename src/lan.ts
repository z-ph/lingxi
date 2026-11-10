/**
 * LAN-only binding and peer checks.
 *
 * M1 binds a single private IPv4 interface (Wi-Fi / LAN) and refuses to listen
 * on `0.0.0.0`, public addresses, or the wildcard IPv6 address. The daemon also
 * rejects peers that are not loopback / RFC1918 / IPv6 ULA or link-local, so a
 * misconfigured bind cannot silently expose the phone to the internet.
 *
 * See docs/security.md ("只绑局域网接口；默认不对外暴露").
 */

import os from 'node:os';
import net from 'node:net';

export interface NetworkInterfaceAddress {
  address: string;
  family: string | number;
  internal: boolean;
}

export type NetworkInterfacesLike = Record<string, NetworkInterfaceAddress[] | undefined>;

export class LanAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LanAddressError';
  }
}

function ipv4Octets(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    octets.push(value);
  }
  return octets;
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = stripScopeAndMapping(address);
  if (normalized === '::1') return true;
  const octets = ipv4Octets(normalized);
  return octets !== null && octets[0] === 127;
}

export function isPrivateIPv4(address: string): boolean {
  const octets = ipv4Octets(stripScopeAndMapping(address));
  if (octets === null) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isIPv6UniqueLocal(address: string): boolean {
  const normalized = stripScopeAndMapping(address).toLowerCase();
  if (!net.isIPv6(normalized)) return false;
  const first = normalized.split(':')[0] ?? '';
  if (first.length === 0) return false;
  const value = Number.parseInt(first, 16);
  // fc00::/7
  return (value & 0xfe00) === 0xfc00;
}

function isIPv6LinkLocal(address: string): boolean {
  const normalized = stripScopeAndMapping(address).toLowerCase();
  if (!net.isIPv6(normalized)) return false;
  const first = normalized.split(':')[0] ?? '';
  if (first.length === 0) return false;
  const value = Number.parseInt(first, 16);
  // fe80::/10
  return (value & 0xffc0) === 0xfe80;
}

/** Remove an IPv6 zone id and the `::ffff:` IPv4-mapping prefix. */
export function stripScopeAndMapping(address: string): string {
  const withoutScope = address.split('%')[0] ?? address;
  if (withoutScope.toLowerCase().startsWith('::ffff:')) {
    return withoutScope.slice('::ffff:'.length);
  }
  return withoutScope;
}

/**
 * True for addresses the daemon is willing to talk to: loopback, RFC1918
 * IPv4, IPv6 unique-local and IPv6 link-local. Everything else (public IPs,
 * multicast, unspecified) is rejected.
 */
export function isAllowedPeerAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = stripScopeAndMapping(address);
  if (net.isIPv4(normalized)) {
    return isLoopbackAddress(normalized) || isPrivateIPv4(normalized);
  }
  if (net.isIPv6(normalized)) {
    return normalized === '::1' || isIPv6UniqueLocal(normalized) || isIPv6LinkLocal(normalized);
  }
  return false;
}

/** True for addresses the daemon may bind: loopback or a private IPv4. */
export function isBindableAddress(address: string): boolean {
  if (!net.isIPv4(address)) return false;
  if (address === '0.0.0.0') return false;
  return isLoopbackAddress(address) || isPrivateIPv4(address);
}

export function assertBindableAddress(address: string): void {
  if (!isBindableAddress(address)) {
    throw new LanAddressError(
      `refusing to bind ${address}: M1 only binds loopback or a private IPv4 LAN address (not 0.0.0.0, public, or IPv6)`,
    );
  }
}

interface Candidate {
  interfaceName: string;
  address: string;
  score: number;
}

function interfaceScore(name: string): number {
  if (/^(docker|br-|veth|virbr|vmnet|utun|tun|tap|lo)/i.test(name)) return Number.POSITIVE_INFINITY;
  if (/wlan|wifi|^wl/i.test(name)) return 0;
  if (/^en\d|^eth\d/i.test(name)) return 1;
  return 2;
}

/**
 * Pick the LAN address to bind. Wi-Fi interfaces win over Ethernet, and
 * virtual bridges are ignored. Throws when the machine has no usable private
 * IPv4 interface, so the daemon never falls back to `0.0.0.0`.
 */
export function resolveLanAddress(interfaces: NetworkInterfacesLike = os.networkInterfaces()): string {
  const candidates: Candidate[] = [];
  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;
    const score = interfaceScore(interfaceName);
    if (!Number.isFinite(score)) continue;
    for (const entry of addresses) {
      if (entry.internal) continue;
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (!isPrivateIPv4(entry.address)) continue;
      // 169.254/16 is link-local, not a useful LAN address for clients.
      if (entry.address.startsWith('169.254.')) continue;
      candidates.push({ interfaceName, address: entry.address, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.interfaceName.localeCompare(b.interfaceName));
  const chosen = candidates[0];
  if (!chosen) {
    throw new LanAddressError(
      'no private IPv4 LAN interface found; connect the phone/computer to Wi-Fi or pass --host 127.0.0.1 for local testing',
    );
  }
  return chosen.address;
}

/** Format an address for a URL or Host header (IPv6 gets brackets). */
export function formatHostForUrl(address: string): string {
  return net.isIPv6(address) ? `[${address}]` : address;
}

/** Host header values accepted by the daemon for a given bind address/port. */
export function allowedHostHeaders(bindAddress: string, port: number): Set<string> {
  const values = new Set<string>();
  const add = (host: string): void => {
    values.add(`${host}:${port}`.toLowerCase());
  };
  add(formatHostForUrl(bindAddress));
  if (isLoopbackAddress(bindAddress)) {
    add('127.0.0.1');
    add('localhost');
    add('[::1]');
  }
  return values;
}
