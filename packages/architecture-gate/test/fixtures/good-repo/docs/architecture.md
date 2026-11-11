# Architecture

[简体中文](architecture.md) | [English](en/architecture.md)

Fixture architecture document.

## Machine contract

```json architecture-gate
{
  "schemaVersion": 1,
  "node": ">=22",
  "workspaces": ["packages/*"],
  "packageNamePrefix": "@phone-as-tool/",
  "packages": {
    "@phone-as-tool/contracts": {
      "dir": "packages/contracts",
      "layer": 0,
      "mayDependOn": []
    },
    "@phone-as-tool/device": {
      "dir": "packages/device",
      "layer": 1,
      "mayDependOn": ["@phone-as-tool/contracts"]
    },
    "@phone-as-tool/daemon": {
      "dir": "packages/daemon",
      "layer": 2,
      "mayDependOn": ["@phone-as-tool/contracts", "@phone-as-tool/device"]
    }
  },
  "runtimeDependencies": {}
}
```
