import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision'

export interface HandInfo {
  /** Index fingertip — normalized [0,1] coords from MediaPipe (NOT yet mirrored). */
  x: number
  y: number
  /** True when the hand is open (≥3 fingers extended) → long-blade mode. */
  openHand: boolean
}

/**
 * Wraps MediaPipe HandLandmarker. Loads the wasm runtime and model from local
 * files bundled in /public (no CDN), runs in VIDEO mode for a single hand, and
 * exposes the index fingertip (landmark 8) per frame.
 */
export class HandTracker {
  private landmarker: HandLandmarker | null = null
  private lastVideoTime = -1
  // Debounced open-hand state so the long blade doesn't flicker on/off from
  // momentary mis-detections while moving.
  private openState = false
  private onStreak = 0
  private offStreak = 0

  async init(): Promise<void> {
    // wasm files copied into /public/wasm
    const fileset = await FilesetResolver.forVisionTasks('/wasm')
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: '/models/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
    })
  }

  /**
   * Detect the index fingertip + hand pose for the current video frame.
   * Returns null when no hand is present or the tracker isn't ready.
   * Coordinates are normalized [0,1] in the video's own (un-mirrored) space.
   */
  detect(video: HTMLVideoElement, timestampMs: number): HandInfo | null {
    if (!this.landmarker) return null
    // detectForVideo requires strictly increasing timestamps.
    if (timestampMs <= this.lastVideoTime) return null
    this.lastVideoTime = timestampMs

    let result: HandLandmarkerResult
    try {
      result = this.landmarker.detectForVideo(video, timestampMs)
    } catch {
      return null
    }

    if (!result.landmarks || result.landmarks.length === 0) {
      this.resetOpenState()
      return null
    }
    const lm = result.landmarks[0]
    const tip = lm[8] // index fingertip
    if (!tip) return null
    return { x: tip.x, y: tip.y, openHand: this.debouncedOpenHand(lm) }
  }

  /**
   * Hysteresis on the open-hand gesture: only engage the long blade after the
   * hand is clearly open (≥4 fingers) for a few frames, and only disengage
   * after it's clearly closed (≤2 fingers) for a few frames. Ambiguous counts
   * (3) hold the current state. Prevents accidental "stick" flicker.
   */
  private debouncedOpenHand(lm: Landmark[]): boolean {
    const ext = countExtendedFingers(lm)
    if (ext >= 4) {
      this.onStreak++
      this.offStreak = 0
    } else if (ext <= 2) {
      this.offStreak++
      this.onStreak = 0
    } else {
      this.onStreak = 0
      this.offStreak = 0
    }
    if (this.onStreak >= 3) this.openState = true
    if (this.offStreak >= 3) this.openState = false
    return this.openState
  }

  private resetOpenState(): void {
    this.openState = false
    this.onStreak = 0
    this.offStreak = 0
  }

  close(): void {
    this.landmarker?.close()
    this.landmarker = null
  }
}

type Landmark = { x: number; y: number; z: number }

/**
 * Count extended fingers (index, middle, ring, pinky) in an orientation-
 * independent way: a finger is extended when its tip is farther from the wrist
 * than its PIP joint. The thumb is ignored (unreliable). Used to tell a
 * pointing pose (1 finger) from an open hand (4 fingers).
 */
function countExtendedFingers(lm: Landmark[]): number {
  const wrist = lm[0]
  const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y)
  // [tip, pip] pairs for index, middle, ring, pinky.
  const fingers: [number, number][] = [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ]
  let count = 0
  for (const [tip, pip] of fingers) {
    if (dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.08) count++
  }
  return count
}
