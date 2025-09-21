export interface TrimSilenceOptions {
  threshold?: number
  windowMs?: number
  minActiveMs?: number
  paddingMs?: number
}

export interface TrimSilenceResult {
  data: Float32Array
  leadPaddingMs: number
  tailPaddingMs: number
}

export function trimSilence(
  audioData: Float32Array,
  sampleRate: number,
  options: TrimSilenceOptions = {}
): TrimSilenceResult {
  const {
    threshold = 0.003,
    windowMs = 20,
    minActiveMs = 40,
    paddingMs = 40
  } = options

  if (!audioData || audioData.length === 0) {
    return { data: audioData, leadPaddingMs: 0, tailPaddingMs: 0 }
  }

  const windowSamples = Math.max(1, Math.floor((sampleRate * windowMs) / 1000))
  const paddingSamples = Math.max(0, Math.floor((sampleRate * paddingMs) / 1000))
  const requiredActiveWindows = Math.max(1, Math.ceil(minActiveMs / windowMs))

  let startIndex = 0
  let activeCount = 0

  for (let i = 0; i <= audioData.length - windowSamples; i += windowSamples) {
    let energy = 0
    for (let j = 0; j < windowSamples; j++) {
      const sample = audioData[i + j]
      energy += sample * sample
    }
    energy = Math.sqrt(energy / windowSamples)

    if (energy > threshold) {
      activeCount++
      if (activeCount >= requiredActiveWindows) {
        startIndex = Math.max(0, i - paddingSamples)
        break
      }
    } else {
      activeCount = Math.max(0, activeCount - 1)
    }
  }

  let endIndex = audioData.length
  activeCount = 0

  for (let i = audioData.length - windowSamples; i >= 0; i -= windowSamples) {
    let energy = 0
    for (let j = 0; j < windowSamples; j++) {
      const index = i + j
      if (index >= audioData.length) break
      const sample = audioData[index]
      energy += sample * sample
    }
    energy = Math.sqrt(energy / windowSamples)

    if (energy > threshold) {
      activeCount++
      if (activeCount >= requiredActiveWindows) {
        endIndex = Math.min(audioData.length, i + windowSamples + paddingSamples)
        break
      }
    } else {
      activeCount = Math.max(0, activeCount - 1)
    }
  }

  if (endIndex <= startIndex) {
    return { data: audioData, leadPaddingMs: 0, tailPaddingMs: 0 }
  }

  const trimmed = audioData.slice(startIndex, endIndex)
  const leadPaddingMs = (startIndex / sampleRate) * 1000
  const tailPaddingMs = ((audioData.length - endIndex) / sampleRate) * 1000

  return {
    data: trimmed,
    leadPaddingMs,
    tailPaddingMs
  }
}
