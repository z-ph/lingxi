# 30-second demo: select, copy and paste in a note

Status: defined in M0 (issue #1). The recording itself is an M1 acceptance artifact; this document
is the task, the script and the recording plan.

## TL;DR

| | |
| --- | --- |
| Task | In a phone note app, scroll to the end of a long note, long-press to select the last sentence, drag the selection, copy it to another note, and type a short suffix. |
| Apps | Markor 2.x from F-Droid, local and account-free (or the device's stock notes app). |
| Why this one | It covers scrolling, long-press, drag, copy/paste and typing in one take; no physical props, external filming or account, and screen recording is enough. |
| Recording | Phone screen recording plus a laptop-trace picture-in-picture; the agent starts the recording and assembles it, and the human only starts the session (one screen-recording permission on first use). |
| Real-device proof | The screen recording shows the real apps, status bar and UI operations; the video description records the device model/Android version; the raw recording is retained. |
| Privacy | Dedicated devices, no accounts, public note text, masked token/IP, frame-by-frame review. |
| Fits M1 | Uses the six M1 tools plus `swipe` from the tool contract for scrolling, long-press and drag. |
| Platform | Android; iOS is out of scope (see section 1). |

## 1. The task

**Prompt** (typed into a fresh agent session):

> Open `demo.md` in Markor and scroll to the end. Long-press to select the last sentence, drag the
> selection, and copy it. Open `paste.md`, paste the text, and type `Copied by the agent.`. Use only
> this project's tools. Do not send, call, pay or delete anything.

**Reference setup**

| Item | Reference | Notes |
| --- | --- | --- |
| Phone | Pixel 6a, Android 14 | Any real Android phone; this demo covers Android only |
| Notes app | Markor 2.x from F-Droid, local, no account | Or the device's stock notes app; it must need no account |
| Note content | `demo.md` is a public pangram paragraph; `paste.md` is empty | Created by the agent before the take |
| Agent | Claude Code / Cursor / DSH over this project's LAN MCP | Agent and model versions go in the video description |

**Platform scope**: this demo covers Android only. iOS is not in the current project scope: iOS has
no equivalent public accessibility surface, and the README lists iOS as a non-goal. Supporting iOS
later needs a separate issue and a separate demo plan.

**Starting state** (prepared by the agent before the take, not counted in the 30 seconds):

- Create `demo.md` in Markor with 20-25 lines of public pangrams (e.g.
  `The quick brown fox jumps over the lazy dog.`), save it, and create an empty `paste.md`.
- Open `demo.md` at the top; confirm `paste.md` is in the file list.
- Start the phone screen recording and the laptop trace recording; clear notifications and the
  clipboard.
- The human only starts the agent session; no filming, cards or phone handling.

**Steps (what the agent does)**

1. `launch_app(package="net.gsantner.markor")`, then `wait_for` the editor.
2. `swipe` up to scroll to the end of `demo.md`.
3. `screenshot` / `ui_tree` to locate the last sentence.
4. Long-press the last sentence: an in-place `swipe` of about 800 ms, or `tap` with a hold
   parameter if the daemon supports it.
5. `swipe` the selection handle to extend the selection to the end of the sentence (press and drag).
6. `tap` Copy in the context menu.
7. `tap` Back to the file list, then open `paste.md`.
8. Long-press the editor, then `tap` Paste.
9. `type("Copied by the agent.")`, then save.
10. `screenshot` to verify that `paste.md` matches the selected sentence from `demo.md`.

**Expected result**: `paste.md` contains the last sentence copied from `demo.md` plus
`Copied by the agent.`; the recording shows the scroll, long-press, selection drag, copy and paste.

**Success predicate**: `paste.text` contains `demo.selected_text`, and `demo.selected_text` equals
the last sentence of `demo.md`.

**Why this task**

The goal is an agent completing a multi-step text operation on a phone the way a human would, not
a one-shot tap:

- **Complete basic operations**: scrolling, long-press, drag, copy, paste and typing in one take.
- **No physical props**: no card, stand, external camera, lighting or hand clap; screen recording is
  enough.
- **Few human tasks**: the agent prepares the notes, starts the recording and assembles the video;
  the human only starts the session.
- **Real apps**: Markor is a real, account-free notes app; the recording shows the real Android UI.
- **Fits 30 seconds**: about ten tool calls; the notes are pre-created and the take only performs
  the operations.
- **Reproducible**: any Android phone, one account-free notes app, one public paragraph.
- **Privacy-safe**: no account, message, payment or personal content is touched.

**Alternatives considered**

| Candidate | Why not |
| --- | --- |
| Camera reads a card | Needs a physical card, external filming or a human placing it; the review explicitly does not need it, and screen recording is enough. |
| Drag the brightness slider in Settings, then read device info | Covers scroll and drag, but misses long-press, selection and copy/paste, and has a weak success predicate. |
| Send a WeChat / SMS message | Needs accounts and private data; sending is the M2 dangerous-action gate. |
| Calculator computes a random expression | Covers taps and typing only; no scroll, drag or selection. |
| Browser reads a random code | Needs a local page, bookmark and extra setup; it adds human work rather than removing it. |

## 2. The script (30 s hard cap)

**Agent** = the line shown on the laptop and read by the laptop's live TTS. **Phone** = what the
phone screen does. **Viewer** = the phone screen recording plus the laptop-trace inset.

| Time | Agent says | Phone does (this project's tools) | Viewer sees |
| --- | --- | --- | --- |
| 0:00 | (prompt on screen) "Scroll to the end of the note, select the last sentence and copy it to the other note." | At the top of `demo.md` | Phone recording: the long Markor note; inset: the agent session |
| 0:02 | "First, scroll to the end." | `swipe` up | The note scrolls to the bottom; the trace shows `swipe` |
| 0:05 | "Long-press to select the last sentence." | In-place long-press (slow `swipe`) | Selection handles appear; the trace shows the hold |
| 0:08 | "Drag the selection to the end of the sentence." | `swipe` the selection handle | The last sentence is fully selected; the trace shows the drag |
| 0:11 | "Copy." | `tap` Copy | The system copy menu; the selection is highlighted |
| 0:13 | "Open paste.md." | `tap` Back; `tap` `paste.md` | The file list and the empty editor |
| 0:16 | "Paste." | Long-press the editor; `tap` Paste | The copied sentence appears in `paste.md` |
| 0:19 | "Add a note." | `type("Copied by the agent.")` | The suffix appears in the note |
| 0:22 | "Done. The note matches." | `screenshot` | The note content matches the source sentence |
| 0:26 | "Your phone, as a tool for agents." | - | End title; the phone recording ends |

Timing is a target, not frame-accurate. The final cut is at most 30.0 s and the action is real-time;
if the take runs long, shorten the agent's speech, never speed up the footage.

**The operator's only jobs**: start the agent session; grant the screen-recording permission once if
prompted. The agent does everything else; the operator does not touch the phone between 0:00 and
0:26.

**Contingencies**

- Long-press does not start a selection: use `tap` with the hold parameter, or hold 200 ms longer.
- The selection handle does not drag: use a `swipe` from the end of the selection to the end of the
  sentence; if that fails, select the whole paragraph.
- Markor's copy/paste menu differs: use the system clipboard Copy/Paste, or verify with
  `observe(clipboard)`.
- The screen recorder fails to start: use the daemon's screenshot stream and let the agent assemble
  the video; do not ask a human to film the phone.
- `paste.md` is missing from the file list: create it with Markor's new-note button.

## 3. Recording plan

### 3.1 Sources

- **Phone screen recording (master)**: the agent starts the phone's built-in screen recorder from
  the Quick Settings tile, or uses the daemon's recording/screenshot stream when available. The
  recording includes the status bar, the Markor UI and the tap/swipe trace when "Show taps" is on.
- **Retrieval**: if the phone's built-in recorder is used, the agent retrieves the file through the
  system share sheet to a local HTTP server on the laptop; if the daemon provides a screen-capture
  stream, no retrieval is needed.
- **Laptop trace (inset)**: the agent starts OBS or a terminal capture on the laptop, showing the
  MCP tool calls and arguments; it appears as a bottom-right picture-in-picture.
- **Assembly**: the agent uses ffmpeg to combine the phone recording and the trace inset into
  1920x1080, 30 fps, H.264, AAC 48 kHz, at most 30.0 s; the raw phone recording is retained.
- **Sync**: align the phone status-bar clock with the trace timestamps; do not cut actions or speed
  them up; trim only at the ends.
- **Not needed**: external camera, tripod, lighting, hand clap, or the physical phone in frame.

### 3.2 Audio and language

- The laptop's TTS reads the agent's lines live and the laptop mic or system audio captures them;
  no post-dubbing.
- The phone recording does not depend on a mic; keep any touch sounds it contains.
- English voice with burned-in English captions, plus a Chinese subtitle track. A Chinese-voice cut
  may reuse the same recording with the same rules.

### 3.3 Export

- 1920x1080, 30 fps, H.264, AAC 48 kHz, at most 30.0 s.
- Strip metadata; do not publish personal content beyond the raw recording.

### 3.4 Pre-flight checklist

- [ ] Phone on Wi-Fi only; no USB/ADB/scrcpy.
- [ ] Dedicated demo device/user; no personal accounts, notifications, chats or clipboard content.
- [ ] `demo.md` / `paste.md` prepared; Markor open at the top of `demo.md`.
- [ ] Phone screen recording granted and started; laptop recording started; a 5 s test take reviewed.
- [ ] "Show taps" enabled; brightness sufficient.
- [ ] Token, LAN IP and QR out of the recording/trace or masked.

## 4. How the video proves it is a real phone

- The recording shows the real Android status bar, the Markor UI and the system select/copy/paste
  menus; an emulator can imitate the UI, but it cannot show real touch and system clipboard
  behaviour.
- The video description records the phone model, Android version, Markor version, network and
  agent/model versions; an optional `Settings > About phone` shot at the start can show the model
  and version (mask IMEI and serial).
- The raw recording is retained; the cut only trims the ends and adds the inset, without reordering
  actions.
- Trace and screen agree: `swipe` matches the scroll/drag, `tap` lands on Copy/Paste, and `type`
  matches the suffix.
- **Limitation**: a screen recording is weaker evidence than filming the physical phone; per the
  owner's direction this demo uses screen recording and does not claim it alone proves a physical
  device. If stronger proof is needed later, an optional physical shot can be added, but it is not
  required here.
- No USB/ADB/emulator; the agent drives the phone over the LAN MCP.

## 5. Privacy

- **Dedicated demo phone/laptop**: no personal accounts, contacts, messages, call log, photos,
  notes or files; airplane mode with Wi-Fi on; no lock-screen notifications; no SIM or a data-only
  demo SIM.
- **Public text**: `demo.md` contains only public pangrams; no names, numbers, addresses, links or
  credentials.
- **Recording scope**: only Markor and the optional Settings screen; no notifications, chats,
  browser tabs or shell history.
- **Mask or keep out of frame**: token, LAN IP, QR, device serial and IMEI, account emails and
  avatars.
- **Clipboard**: clear it before the take and after.
- **Post-production**: frame-by-frame review before publishing; mask every frame that needs it;
  strip metadata; wipe or rotate the demo devices afterwards.
- **No dangerous actions**: no send, call, payment, delete or account change; the send-a-message
  demo is the M2 confirmation-gated demo.

## 6. Mapping to issue #1

- **Task chosen**: section 1 names the app, steps and expected result; Markor is a real app and the
  phone is a real Android device.
- **Script**: section 2 gives what the agent says, what the phone does and what the viewer sees.
- **Recording plan**: section 3 covers the phone screen plus the laptop trace and no private data;
  section 4 states the real-device proof and its limitation.
- **M1 demo acceptance**: a recording passes when it meets section 1's success predicate and
  section 4's proof points.

## 7. Follow-ups (not this change)

- Record the M1 take on the reference device following this plan and attach it to the M1 demo
  acceptance.
- If stronger real-device proof is needed, open a separate issue for an optional physical shot.
- iOS support needs a separate project; it is out of scope here.
- Add the finished video to the README docs once it exists (README is untouched here, because
  issue #1 limits this change to the demo docs).
- Check off the M0 roadmap item once this plan is accepted (the owner's call).
