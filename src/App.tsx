import { useEffect, useState } from 'react'
import GameCanvas from './components/GameCanvas'
import { gameAudio } from './game/audio'

type Screen = 'start' | 'playing' | 'gameover'

const HIGH_SCORE_KEY = 'fruitninja.highscore'

const isCoarsePointer = () => window.matchMedia('(pointer: coarse)').matches

/**
 * Best-effort: put the page fullscreen and lock to landscape. Must be called
 * from a user gesture. Returns false (silently) where it isn't supported —
 * notably iOS Safari, which has no orientation lock — so callers fall back to
 * the "please rotate" hint. No-op on desktop (fine pointer).
 */
async function lockLandscape(): Promise<boolean> {
  if (!isCoarsePointer()) return false
  try {
    const el = document.documentElement
    if (el.requestFullscreen && !document.fullscreenElement) {
      await el.requestFullscreen()
    }
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: 'landscape') => Promise<void>
    }
    if (typeof orientation?.lock === 'function') {
      await orientation.lock('landscape')
      return true
    }
  } catch {
    // Unsupported / blocked — the manual rotate hint covers this case.
  }
  return false
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('start')
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(3)
  const [finalScore, setFinalScore] = useState(0)
  const [highScore, setHighScore] = useState(() =>
    Number(localStorage.getItem(HIGH_SCORE_KEY) ?? 0),
  )
  // Remount GameCanvas on each play so camera + engine reset cleanly.
  const [round, setRound] = useState(0)

  const startGame = () => {
    gameAudio.unlock() // must happen inside a user gesture
    void lockLandscape() // best-effort auto-rotate (no-op where unsupported)
    setScore(0)
    setLives(3)
    setRound((r) => r + 1)
    setScreen('playing')
  }

  const handleGameOver = (final: number) => {
    setFinalScore(final)
    if (final > highScore) {
      setHighScore(final)
      localStorage.setItem(HIGH_SCORE_KEY, String(final))
    }
    setScreen('gameover')
  }

  return (
    <div className="h-full w-full relative bg-[#0a0a1a] text-white overflow-hidden">
      <RotateGate />
      {screen === 'playing' && (
        <>
          <GameCanvas
            key={round}
            onScoreChange={setScore}
            onLivesChange={setLives}
            onGameOver={handleGameOver}
          />
          {/* HUD overlay */}
          <div className="pointer-events-none absolute top-0 left-0 right-0 flex items-start justify-between p-3 sm:p-5">
            <div className="text-xl sm:text-3xl font-bold tracking-wide drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]">
              <span className="text-white/60 text-xs sm:text-base align-middle mr-2">SCORE</span>
              {score}
            </div>
            <div className="flex gap-1 text-xl sm:text-3xl drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]">
              {[0, 1, 2].map((i) => (
                <span key={i}>{i < lives ? '❤️' : '🖤'}</span>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === 'start' && (
        <Overlay>
          <h1 className="text-4xl sm:text-6xl font-extrabold mb-3 text-center">🍉 Fruit Ninja</h1>
          <p className="text-base sm:text-xl text-white/80 mb-2 text-center">Slice fruit with your finger ✋</p>
          <p className="text-xs sm:text-sm text-white/50 mb-8 max-w-md text-center">
            Point your index finger and swipe fast through the fruit. Open your
            whole hand ✋ for a wide blade that cuts everything in its radius.
            Miss three and it's game over. Tip: play in landscape for more room.
          </p>
          {highScore > 0 && (
            <p className="text-white/60 mb-6">High score: {highScore}</p>
          )}
          <button
            onClick={startGame}
            className="px-8 py-3 sm:px-10 sm:py-4 rounded-full bg-linear-to-r from-pink-500 to-orange-400 text-lg sm:text-xl font-bold shadow-lg hover:scale-105 active:scale-95 transition-transform"
          >
            Start Game
          </button>
        </Overlay>
      )}

      {screen === 'gameover' && (
        <Overlay>
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-2">Game Over</h1>
          <p className="text-xl sm:text-2xl text-white/80 mb-1">
            Final Score: <span className="font-bold text-white">{finalScore}</span>
          </p>
          <p className="text-white/60 mb-8">High score: {highScore}</p>
          <button
            onClick={startGame}
            className="px-8 py-3 sm:px-10 sm:py-4 rounded-full bg-linear-to-r from-pink-500 to-orange-400 text-lg sm:text-xl font-bold shadow-lg hover:scale-105 active:scale-95 transition-transform"
          >
            Play Again
          </button>
        </Overlay>
      )}
    </div>
  )
}

/**
 * On touch devices held in portrait, suggest rotating — the 16:9 webcam game
 * has far more room (and matches the camera) in landscape. NOT compulsory: the
 * player can rotate automatically ("Rotate for me", where supported) or just
 * dismiss and play in portrait. Never shown on desktop (fine pointer).
 */
function RotateGate() {
  const [portrait, setPortrait] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const touch = window.matchMedia('(pointer: coarse)')
    const orient = window.matchMedia('(orientation: portrait)')
    const update = () => setPortrait(touch.matches && orient.matches)
    update()
    orient.addEventListener('change', update)
    touch.addEventListener('change', update)
    return () => {
      orient.removeEventListener('change', update)
      touch.removeEventListener('change', update)
    }
  }, [])

  if (!portrait || dismissed) return null

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0a1a] px-8 text-center">
      <div className="text-6xl mb-6 animate-pulse">📱↻</div>
      <h2 className="text-2xl font-bold mb-2">Better in landscape</h2>
      <p className="text-white/70 max-w-xs mb-8">
        Turn your phone sideways for more room to slice. You can keep playing in
        portrait if you prefer.
      </p>
      <button
        onClick={() => void lockLandscape()}
        className="px-8 py-3 mb-3 rounded-full bg-linear-to-r from-pink-500 to-orange-400 text-lg font-bold shadow-lg active:scale-95 transition-transform"
      >
        Rotate for me
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="text-white/60 underline underline-offset-4 text-sm"
      >
        Continue in portrait
      </button>
    </div>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,#15152e_0%,#0a0a1a_70%)] px-6">
      {children}
    </div>
  )
}
