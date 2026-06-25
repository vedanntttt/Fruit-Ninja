import { useState } from 'react'
import GameCanvas from './components/GameCanvas'
import { gameAudio } from './game/audio'

type Screen = 'start' | 'playing' | 'gameover'

const HIGH_SCORE_KEY = 'fruitninja.highscore'

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
      {screen === 'playing' && (
        <>
          <GameCanvas
            key={round}
            onScoreChange={setScore}
            onLivesChange={setLives}
            onGameOver={handleGameOver}
          />
          {/* HUD overlay */}
          <div className="pointer-events-none absolute top-0 left-0 right-0 flex items-start justify-between p-5">
            <div className="text-3xl font-bold tracking-wide drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]">
              <span className="text-white/60 text-base align-middle mr-2">SCORE</span>
              {score}
            </div>
            <div className="flex gap-1 text-3xl drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]">
              {[0, 1, 2].map((i) => (
                <span key={i}>{i < lives ? '❤️' : '🖤'}</span>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === 'start' && (
        <Overlay>
          <h1 className="text-6xl font-extrabold mb-3">🍉 Fruit Ninja</h1>
          <p className="text-xl text-white/80 mb-2">Slice fruit with your finger ✋</p>
          <p className="text-sm text-white/50 mb-8 max-w-md text-center">
            Point your index finger and swipe fast through the fruit. Open your
            whole hand ✋ for a long sweeping blade that cuts everything in its
            path. Miss three and it's game over.
          </p>
          {highScore > 0 && (
            <p className="text-white/60 mb-6">High score: {highScore}</p>
          )}
          <button
            onClick={startGame}
            className="px-10 py-4 rounded-full bg-linear-to-r from-pink-500 to-orange-400 text-xl font-bold shadow-lg hover:scale-105 active:scale-95 transition-transform"
          >
            Start Game
          </button>
        </Overlay>
      )}

      {screen === 'gameover' && (
        <Overlay>
          <h1 className="text-5xl font-extrabold mb-2">Game Over</h1>
          <p className="text-2xl text-white/80 mb-1">
            Final Score: <span className="font-bold text-white">{finalScore}</span>
          </p>
          <p className="text-white/60 mb-8">High score: {highScore}</p>
          <button
            onClick={startGame}
            className="px-10 py-4 rounded-full bg-linear-to-r from-pink-500 to-orange-400 text-xl font-bold shadow-lg hover:scale-105 active:scale-95 transition-transform"
          >
            Play Again
          </button>
        </Overlay>
      )}
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
