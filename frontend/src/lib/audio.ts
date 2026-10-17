import * as Tone from 'tone'

// Salamander Grand Piano samples hosted by the Tone.js project. Every minor third is
// sampled; Tone.Sampler pitch-shifts the notes in between.
const SAMPLE_BASE = 'https://tonejs.github.io/audio/salamander/'

function sampleMap() {
  const urls: Record<string, string> = { A0: 'A0.mp3', C8: 'C8.mp3' }
  for (let octave = 1; octave <= 7; octave++) {
    for (const [note, file] of [['C', 'C'], ['D#', 'Ds'], ['F#', 'Fs'], ['A', 'A']]) {
      urls[`${note}${octave}`] = `${file}${octave}.mp3`
    }
  }
  return urls
}

let sampler: Tone.Sampler | null = null
let ready: Promise<void> | null = null

/** Must be called from a user gesture the first time (browser autoplay rules). */
export function loadPiano(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await Tone.start()
      sampler = new Tone.Sampler({ urls: sampleMap(), baseUrl: SAMPLE_BASE, release: 1 }).toDestination()
      await Tone.loaded()
    })()
  }
  return ready
}

export const pianoReady = () => sampler !== null && sampler.loaded

export function playNote(midi: number, seconds: number, time?: number, velocity = 0.8) {
  sampler?.triggerAttackRelease(Tone.Frequency(midi, 'midi').toNote(), seconds, time, velocity)
}

export function noteOn(midi: number, velocity = 0.8) {
  sampler?.triggerAttack(Tone.Frequency(midi, 'midi').toNote(), undefined, velocity)
}

export function noteOff(midi: number) {
  sampler?.triggerRelease(Tone.Frequency(midi, 'midi').toNote())
}

export function silence() {
  sampler?.releaseAll()
}
