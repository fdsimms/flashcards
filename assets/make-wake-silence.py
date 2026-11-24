"""Writes assets/sounds/wake-silence.wav: 0.8 seconds of near silence (a dither of one or two steps,
far below hearing).

Played just before a word when the sound goes to Bluetooth headphones that have been quiet for a
while, so their link is awake when the word starts (src/ui/useOutputWake.ts). The dither keeps it from
being exact zeros, in case a route lets digital silence sleep. Run: python3 assets/make-wake-silence.py
"""
import random
import struct
import wave

RATE = 22050
TOTAL = 0.8

random.seed(1)
frames = b''.join(struct.pack('<h', random.choice((-1, 0, 0, 1))) for _ in range(int(RATE * TOTAL)))

with wave.open('assets/sounds/wake-silence.wav', 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(frames)
