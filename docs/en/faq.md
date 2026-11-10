# FAQ

## Do I need root or developer mode?

No. Phone as Tool uses Android's accessibility service, which you enable in system settings; it does
not depend on USB or ADB debugging, so neither root nor developer mode is required. The controlling
agent connects over LAN MCP.

## Does data leave the phone?

By default, no. The screen, pixels and data stay on the phone; only what the agent explicitly
requests (a screenshot or the UI tree, for example) crosses the wire, and the audit log is stored
locally, exportable and never uploaded. The project is not a hosted cloud service, and using your
own phone requires no account.

## Which Android versions are supported?

Android only for now; iOS is an explicit non-goal because it has no equivalent public accessibility
surface. The exact minimum Android version is not fixed yet, and there is no usable build at this
stage.
