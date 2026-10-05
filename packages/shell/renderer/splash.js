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
