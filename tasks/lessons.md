# Lessons

- music21 `stripTies` misses ties on notes inside chords; merge ties per pitch manually (`_read_notes`).
- Bar numbers can't be derived from note times (pickups, meter changes); store and use the score's barlines.
- OSMD cursor timestamps are in whole notes (`RealValue`); app time is quarter notes → divide by 4.
- Tone.js transport `ticks` include look-ahead; use `getTicksAtTime(Tone.immediate())` for visuals.
- PowerShell 5.1 `Get-Content`/`Set-Content` mangles UTF-8 source files. Edit files with the editor tools.
