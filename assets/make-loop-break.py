"""Writes assets/sounds/loop-break.wav: a soft two-note chime, then silence, 2.2 seconds in all.

Read & Listen plays it between the last line and the first when Loop text wraps, so the restart is
heard as a break instead of the voice jumping straight back. Run: python3 assets/make-loop-break.py
"""
import math
import struct
import wave

RATE = 22050
TOTAL = 2.2
NOTES = [(0.00, 659.25), (0.28, 523.25)]  # E5 then C5, a falling "end of the round" pair
RING = 0.9  # seconds each note takes to fade out

samples = [0.0] * int(RATE * TOTAL)
for start, freq in NOTES:
    for i in range(int(RING * RATE)):
        t = i / RATE
        n = int((start + t) * RATE)
        if n >= len(samples):
            break
        attack = min(1.0, t / 0.01)
        decay = math.exp(-t * 5.0)
        tone = math.sin(2 * math.pi * freq * t) + 0.25 * math.sin(2 * math.pi * freq * 2 * t)
        samples[n] += 0.22 * attack * decay * tone

with wave.open('assets/sounds/loop-break.wav', 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32767)) for s in samples))
