import { FakeDevice } from '@phone-as-tool/device';

export function createDaemon(): { device: FakeDevice } {
  return { device: new FakeDevice() };
}
