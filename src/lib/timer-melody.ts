/**
 * The melody that plays when the timer ends: a soft, rising bell phrase in a pentatonic scale, so every note
 * sounds right with every other and nothing in it is harsh. It plays twice, then stops by itself; the person
 * can stop it at any moment, or switch it off for good.
 */

export interface MelodyNote {
  /** Hz */
  freq: number;
  /** Seconds after the melody starts. */
  start: number;
  /** Seconds the note rings. */
  length: number;
  /** 0..1 */
  volume: number;
}

// C major pentatonic, E5 to E6.
const E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, D6 = 1174.66, E6 = 1318.51;
const PHRASE: Array<[number, number, number]> = [
  [E5, 0, 0.9], [G5, 0.45, 0.9], [A5, 0.9, 0.9], [C6, 1.35, 1.0], [E6, 1.95, 1.8],
  [D6, 2.9, 1.0], [C6, 3.4, 1.0], [A5, 3.9, 1.0], [G5, 4.4, 1.2], [C6, 5.0, 2.4],
];
const PHRASE_SECONDS = 7.5;
const REPEATS = 2;

export function melodyNotes(): MelodyNote[] {
  const notes: MelodyNote[] = [];
  for (let repeat = 0; repeat < REPEATS; repeat += 1) {
    // The second pass is a little quieter, so the ending trails off instead of cutting.
    const volume = repeat === 0 ? 0.2 : 0.14;
    for (const [freq, start, length] of PHRASE) {
      notes.push({ freq, start: start + repeat * PHRASE_SECONDS, length, volume });
    }
  }
  return notes;
}

export const MELODY_SECONDS = PHRASE_SECONDS * REPEATS + 1;

export interface MelodyHandle {
  stop: () => void;
}

/** Plays the melody on an already-unlocked context. Returns a handle, or null when audio is unavailable. */
export function playMelody(ctx: AudioContext, onEnd: () => void): MelodyHandle | null {
  try {
    const master = ctx.createGain();
    master.gain.value = 1;
    // A short echo turns plain tones into something that sounds like a room.
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.28;
    const echoGain = ctx.createGain();
    echoGain.gain.value = 0.28;
    master.connect(ctx.destination);
    master.connect(echo);
    echo.connect(echoGain);
    echoGain.connect(ctx.destination);
    echoGain.connect(echo);

    const origin = ctx.currentTime + 0.05;
    const oscillators: OscillatorNode[] = [];
    for (const note of melodyNotes()) {
      // A sine for the body, a quieter octave above it for the bell shimmer.
      for (const [multiple, level] of [[1, 1], [2, 0.18]] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = note.freq * multiple;
        const at = origin + note.start;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(note.volume * level, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0008, at + note.length);
        osc.connect(gain);
        gain.connect(master);
        osc.start(at);
        osc.stop(at + note.length + 0.05);
        oscillators.push(osc);
      }
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        master.disconnect();
      } catch {
        // already disconnected
      }
      onEnd();
    };
    const timer = setTimeout(finish, MELODY_SECONDS * 1000 + 1500);
    return {
      stop: () => {
        // A quick fade, never a click.
        try {
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
          master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
          oscillators.forEach((osc) => {
            try {
              osc.stop(ctx.currentTime + 0.2);
            } catch {
              // already stopped
            }
          });
        } catch {
          // context closed
        }
        setTimeout(finish, 200);
      },
    };
  } catch {
    return null;
  }
}
