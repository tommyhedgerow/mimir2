/**
 * The startup animation, and when it is allowed to be taken away.
 *
 * The shell does not close this on a timer alone: it asks whether the animation
 * has actually been seen. A splash that appears for eighty milliseconds is a
 * flicker, which is worse than no splash — the point of it is to cover a wait,
 * and it has to have covered something before it goes.
 */
const video = document.getElementById('anim')

// Nothing here is essential; if the video will not play, the poster is enough
// and the shell's own timeout still closes the window.
window.mimirSplashSeen = () =>
  new Promise((resolve) => {
    if (!video) return resolve(false)
    // Already past the opening: either it is running, or it has finished.
    if (!video.paused || video.ended || video.currentTime > 0.25) return resolve(true)

    let done = false
    const finish = (seen) => {
      if (done) return
      done = true
      clearTimeout(giveUp)
      resolve(seen)
    }
    // If it never starts, do not hold the window open for it.
    const giveUp = setTimeout(() => finish(false), 2500)
    video.addEventListener('playing', () => finish(true), { once: true })
    video.addEventListener('error', () => finish(false), { once: true })
    video.play().catch(() => finish(false))
  })

// A video with no soundtrack should never need a click; if autoplay is refused
// the poster stays up and the promise above resolves false rather than hanging.
video?.play?.().catch(() => {})


/**
 * How long the animation runs.
 *
 * The shell asks for this rather than guessing: the clip is several seconds
 * longer than the application takes to start, so dismissing on a fixed timer
 * either cuts the animation off or holds the window hostage to it.
 */
window.mimirSplashDuration = () =>
  Number.isFinite(video?.duration) && video.duration > 0 ? video.duration * 1000 : null

/** Fades out. The shell calls this when the animation has finished. */
window.mimirSplashLeave = () => {
  document.body.classList.add('leaving')
  return true
}


/**
 * Skipping.
 *
 * The animation is 8.7 seconds. It plays in full by default — it was asked for,
 * and an animation cut off halfway is worse than none — but a second viewing is
 * not owed to anybody, so a click or any key takes it away at once.
 *
 * The shell reads `mimirSplashSkipped` to tell the two endings apart, because
 * they mean different things: a finished animation has been watched, and a
 * skipped one has not. Nothing else depends on the difference, but the log
 * should not claim the animation played when somebody dismissed it in the first
 * second.
 */
window.mimirSplashSkipped = false

const skip = () => {
  if (window.mimirSplashSkipped) return true
  window.mimirSplashSkipped = true
  document.body.classList.add('skippable')
  document.body.classList.add('leaving')
  return true
}

window.mimirSplashSkip = skip

// A click anywhere, or any key. Both are what a person tries first.
document.addEventListener('click', skip)
document.addEventListener('keydown', skip)

// The hint appears after a moment, so the animation opens clean and only offers
// the way out to somebody who is still looking at it.
setTimeout(() => {
  if (!window.mimirSplashSkipped) document.body.classList.add('skippable')
}, 1200)
