import type { ToolContract } from '@phone-as-tool/contracts';

export interface Device {
  describe(): ToolContract;
}

export class FakeDevice implements Device {
  describe(): ToolContract {
    return { name: 'fake-device', description: 'In-memory fixture device.' };
  }
}
