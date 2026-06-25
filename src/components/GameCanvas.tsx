import { useEffect, useRef, useState } from 'react'
import { GameEngine } from '../game/GameEngine'
import { HandTracker } from '../game/HandTracker'

// Match the webcam's 16:9 aspect so object-cover does NOT crop horizontally —
// this keeps the fingertip→canvas mapping 1:1 across the whole width (so the
// blade lines up with fruit at the edges, not just the center).
const GAME_W = 1280
const GAME_H = 720

interface GameCanvasProps {
  onScoreChange: (score: number) => void
  onLivesChange: (lives: number) => void
  onGameOver: (finalScore: number) => void
}

type Status = 'loading' | 'ready' | 'error'

export default function GameCanvas({
  onScoreChange,
  onLivesChange,
  onGameOver,
}: GameCanvasProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    let raf = 0
    let stopped = false
    let stream: MediaStream | null = null
    const tracker = new HandTracker()
    let engine: GameEngine | null = null

    async function setup() {
      try {
        // 1) Camera
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
          audio: false,
        })
        // StrictMode (dev) may have already torn this effect down.
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        video!.srcObject = stream
        await video!.play()

        // 2) Hand tracker (loads local wasm + model)
        await tracker.init()
        if (stopped) return

        // 3) Engine
        engine = new GameEngine(canvas!, {
          onScoreChange,
          onLivesChange,
          onGameOver: (s) => {
            onGameOver(s)
          },
        })
        engine.reset()
        engine.start()
        setStatus('ready')

        const loop = () => {
          if (stopped || !engine) return
          // Never let a single bad frame kill the loop (which would freeze the
          // screen). Catch, log, and always reschedule.
          try {
            const now = performance.now()
            if (video!.readyState >= 2) {
              const hand = tracker.detect(video!, now)
              if (hand) {
                // Mirror X because the displayed video is flipped horizontally.
                const x = (1 - hand.x) * GAME_W
                const y = hand.y * GAME_H
                engine.updateFingertip(x, y, true, hand.openHand)
              } else {
                engine.updateFingertip(0, 0, false, false)
              }
            }
            engine.tick(now)
          } catch (e) {
            console.error('[game loop] frame error (continuing):', e)
          } finally {
            if (!stopped) raf = requestAnimationFrame(loop)
          }
        }
        raf = requestAnimationFrame(loop)
      } catch (err) {
        if (stopped) return
        const e = err as Error
        const denied =
          e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError'
        setErrorMsg(
          denied
            ? 'Camera access was denied. Please allow the camera and reload.'
            : `Could not start the game: ${e.message}`,
        )
        setStatus('error')
      }
    }

    void setup()

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      engine?.stop()
      tracker.close()
      stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="relative h-full w-full flex items-center justify-center">
      <div
        className="relative shadow-2xl rounded-xl overflow-hidden"
        style={{
          // Fit the 16:9 box inside both the width and the height of the screen
          // so it scales up on desktop and stays fully visible on phones.
          width: 'min(96vw, calc(92svh * 16 / 9), 1180px)',
          aspectRatio: `${GAME_W} / ${GAME_H}`,
        }}
      >
        {/* Mirrored, dimmed webcam background */}
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: 'scaleX(-1)', filter: 'brightness(0.6)' }}
        />
        {/* Game canvas overlay */}
        <canvas
          ref={canvasRef}
          width={GAME_W}
          height={GAME_H}
          className="absolute inset-0 h-full w-full"
        />

        {status === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a1a]/90 text-center px-6">
            <div className="h-10 w-10 mb-4 rounded-full border-4 border-white/20 border-t-white animate-spin" />
            <p className="text-lg font-medium">Loading hand tracking…</p>
            <p className="text-sm text-white/60 mt-1">
              Allow camera access when prompted.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a1a]/95 text-center px-6">
            <p className="text-4xl mb-3">📷</p>
            <p className="text-lg font-medium text-red-300">{errorMsg}</p>
          </div>
        )}
      </div>
    </div>
  )
}
