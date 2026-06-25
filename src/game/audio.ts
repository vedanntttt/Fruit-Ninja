/**
 * Synthesized sound effects via the Web Audio API — no audio assets.
 * The AudioContext must be created/resumed from a user gesture (Start button),
 * so call `unlock()` there.
 */
class GameAudio {
  private ctx: AudioContext | null = null

  /** Create/resume the AudioContext. Call from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      this.ctx = new Ctor()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** A "whoosh-thunk" blade slice: filtered noise burst + downward pitch sweep. */
  playSlice(): void {
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime

    // Noise burst (the "whoosh")
    const dur = 0.18
    const bufferSize = Math.floor(ctx.sampleRate * dur)
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize
      data[i] = (Math.random() * 2 - 1) * (1 - t) // decaying white noise
    }
    const noise = ctx.createBufferSource()
    noise.buffer = buffer

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.setValueAtTime(2200, now)
    bandpass.frequency.exponentialRampToValueAtTime(600, now + dur)
    bandpass.Q.value = 0.8

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.35, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur)

    noise.connect(bandpass).connect(noiseGain).connect(ctx.destination)
    noise.start(now)
    noise.stop(now + dur)

    // Tonal "thunk" — downward triangle sweep
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(520, now)
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.14)
    const oscGain = ctx.createGain()
    oscGain.gain.setValueAtTime(0.25, now)
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14)
    osc.connect(oscGain).connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.14)
  }

  /** A low "thud" when a fruit is missed. */
  playMiss(): void {
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(180, now)
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.3)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.4, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.35)
  }
}

export const gameAudio = new GameAudio()
