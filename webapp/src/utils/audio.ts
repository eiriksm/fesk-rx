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

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i))
  }
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

export function audioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const bitsPerSample = 16
  const blockAlign = (numChannels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const dataLength = audioBuffer.length * blockAlign
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  const clamp = (sample: number) => Math.max(-1, Math.min(1, sample))

  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = clamp(audioBuffer.getChannelData(channel)[i])
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      view.setInt16(offset, intSample, true)
      offset += 2
    }
  }

  return new Blob([buffer], { type: 'audio/wav' })
}
