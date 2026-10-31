# Reader voice playback — design

Date: 2026-10-31

## Problem
- The reader shows recorded dialogue lines but has no audio at all.
- The bridge plugin (`plugin/RPGViewerBridge.js`) records `message` records (src, cmd, face, speaker, text) but no sound information.
- The user wants: voice for each line is recorded; in the reader, when a line becomes the line being read, its voice plays automatically; the auto-play can be switched off. A manual per-line replay is also expected ("음성 재생도 안되는데").

## Where voices come from (RPG Maker MV/MZ)
1. **Event command Play SE (code 250)** right before Show Text (101), with only Wait (230) / Comment (108/408) / other non-text commands between. Most common.
2. **Plugins / text codes** that call `AudioManager.playSe` / `AudioManager.playVoice` (some voice plugins add `playVoice`, folder `audio/voice` or similar) while the message is displayed.
- System UI sounds go through `AudioManager.playStaticSe` (SoundManager) — never voices, ignore.

## Design

### 1. Bridge: record voices (bump plugin version as the code does for other changes)
- Hook `AudioManager.playSe` and, if it exists, `AudioManager.playVoice` (and any other `AudioManager.play*` method that a voice plugin adds whose folder is not bgm/bgs/me — keep it simple: playSe + playVoice). Do NOT hook `playStaticSe`.
- Sound entry: `{ folder: "se" | "<voice folder>", name, volume, pitch, pan }`.
- Filter to the message's own interpreter: if the sound is played inside `executeCommand` of an interpreter (`currentCtx`), accept it only when it is the same interpreter that showed / will show the message (the map/battle main interpreter or the common-event child chain), not a parallel event. Sounds played outside any interpreter context (message window text codes, plugin code) are accepted only while a message is displayed.
- **Before the message:** sounds accepted while no message is showing are buffered; the buffer is cleared when a message closes, on map transfer, on battle start/end, and when entries are older than ~2 s. When `command101` emits the `message` record, attach the buffer as `voice: [...]` and clear it.
- **During the message:** sounds accepted while a message is showing are emitted as a separate small record `{ type: "voice", msg: <seq of the message record>, ...sound }` (or the equivalent linking the existing record system supports). Do not delay the message record for this.
- Lines recorded before this change have no voice field; see 3.

### 2. Viewer: load audio
- Extend the asset layer (`src/core/assets/assets.ts`, `decrypt.ts`, and however images are served in local, LAN share and remote modes) with audio: path `audio/<folder>/<name>` trying `.ogg`, `.m4a`, encrypted `.rpgmvo`, `.ogg_`, `.m4a_`.
- Decrypt encrypted audio: strip the 16-byte "RPGMV" header, XOR the next 16 bytes with the `System.json` `encryptionKey` (same scheme as `decryptImage`). Without a key, OGG can be restored from the fixed `OggS` page head where possible; if not possible, the line is just silent.
- Play with an `HTMLAudioElement` / object URL (volume from the record, pitch → `playbackRate` = pitch/100, pan ignored). Revoke URLs on cleanup; cache a small number of decoded clips.

### 3. Fallback for old records (no `voice` field)
- If the game data is loaded and the message's `src`/`cmd` points into an event list, look backwards from `cmd` over Wait/Comment/other non-display commands (stop at another 101/102/103/104/105 or the list start) for Play SE (250) and use those as the voice. This makes already-recorded logs work for the common case. Pure function with unit tests.

### 4. Reader UI (shadcn components only, no custom design)
- Toolbar toggle "음성 자동 재생" (shadcn `Toggle` or `Switch` in the existing reader toolbar/menu). Default ON. Remember it per viewer (same place the reader keeps other viewer preferences; localStorage wrapped in try/catch is fine).
- Lines that have a voice show a small ghost icon button (lucide `Volume2`) to play it manually — works whether auto-play is on or off.
- Auto-play: when the reader's current line (the reading position already tracked by `src/ui/live/readPosition.ts` / `ReaderView.tsx`) changes and settles for ~400 ms, stop whatever is playing and play that line's voice. Do not play while the user is fast-scrolling; do not replay the same line repeatedly when nothing changed. Turning the toggle off stops playback immediately.
- Hidden lines (reader hide rules) never auto-play.
- The browser may block audio until the first user interaction; if `play()` rejects, stay silent (no error UI) — after the first click/key it works.

## Out of scope
- BGM/BGS/ME playback, volume mixer, voice-only file filtering by name.
