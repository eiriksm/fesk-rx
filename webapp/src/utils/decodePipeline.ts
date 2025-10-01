import { trimSilence } from './audio'

export interface DecodePipelineResult {
  frame: any
  symbols: number[]
  frequencySet: string | null
  startTime: number | null
}

interface DecodePipelineOptions {
  preferExtractor?: boolean
}

export async function decodeWithDefaultPipeline(
  originalData: Float32Array,
  sampleRate: number,
  options: DecodePipelineOptions = {},
): Promise<DecodePipelineResult> {
  const { FeskDecoder } = await import('@fesk/feskDecoder')
  const decoder = new FeskDecoder()

  const { data: trimmedData, leadPaddingMs } = trimSilence(originalData, sampleRate)
  const workingData = trimmedData.length > 0 ? trimmedData : originalData
  const preferExtractor = options.preferExtractor ?? sampleRate >= 47000

  const buildSample = (data: Float32Array) => ({
    data,
    sampleRate,
    duration: data.length / sampleRate,
  })

  const runSymbolExtractor = async (data: Float32Array) => {
    if (!data || data.length === 0) return null
    try {
      decoder.reset()

      // Optimized parameters for faster decoding
      const isLowerSampleRate = sampleRate <= 46000
      const duration = data.length / sampleRate
      const detectedStart = decoder.findTransmissionStart(data, sampleRate)
      const detectedSeconds = detectedStart !== null ? detectedStart / 1000 : duration * 0.08

      const startTimeRange = {
        start: Math.max(0, detectedSeconds - 0.6),
        end: Math.min(duration - 0.25, detectedSeconds + 3.0),
        step: 0.04, // Larger step for faster search
      }

      const symbolDurations = isLowerSampleRate
        ? [0.098, 0.1, 0.102]
        : [0.108, 0.109, 0.112]

      const candidate = await decoder.decodeAudioDataWithSymbolExtractor(
        data,
        sampleRate,
        {
          startTimeRange,
          symbolDurations,
          symbolsToExtract: 90,
          windowFraction: 0.6,
          minConfidence: isLowerSampleRate ? 0.08 : 0.12,
          candidateOffsets: [0, -0.01, 0.01, -0.015, 0.015],
        },
      )

      if (!candidate) return null

      const info = decoder.getLastSymbolExtractorInfo()
      return {
        frame: candidate,
        symbols: decoder.toneDetector.extractSymbols(buildSample(data), 0),
        frequencySet: info?.frequencySet ?? null,
      }
    } catch (error) {
      console.error('Symbol extractor attempt failed:', error)
      return null
    }
  }

  let frame: any = null
  let symbols: number[] = []
  let frequencySet: string | null = null
  let startTime: number | null = null

  // Always try processAudioComplete FIRST (faster method)
  console.log('Trying processAudioComplete first for speed...')
  decoder.reset()

  startTime = decoder.findTransmissionStart(workingData, sampleRate)

  let extractorInput = workingData

  if (startTime !== null) {
    let decodeStartMs = startTime

    if (sampleRate >= 47000) {
      decodeStartMs += 300
    }

    const startSeconds = decodeStartMs / 1000
    const offsetIndex = Math.floor(startSeconds * sampleRate)
    const offsetData = workingData.slice(offsetIndex)

    extractorInput = offsetData

    frame = await decoder.processAudioComplete(offsetData, sampleRate, 100)
    symbols = decoder.toneDetector.extractSymbols(buildSample(offsetData), 0)
  } else {
    frame = await decoder.processAudioComplete(workingData, sampleRate, 100)
    symbols = decoder.toneDetector.extractSymbols(buildSample(workingData), 0)
  }

  if (frame && frame.isValid) {
    console.log('✅ processAudioComplete succeeded')
  }

  // Track what we've tried with extractor
  let extractorAttemptedTrimmed = false
  let extractorAttemptedOriginal = workingData === originalData

  if (!frame || !frame.isValid) {
    if (extractorInput !== workingData && extractorInput.length > 0) {
      const offsetResult = await runSymbolExtractor(extractorInput)

      if (offsetResult) {
        frame = offsetResult.frame
        symbols = offsetResult.symbols
        frequencySet = offsetResult.frequencySet ?? frequencySet
      }
    }

    if ((!frame || !frame.isValid) && !extractorAttemptedTrimmed) {
      const trimmedResult = await runSymbolExtractor(workingData)
      extractorAttemptedTrimmed = true

      if (trimmedResult) {
        frame = trimmedResult.frame
        symbols = trimmedResult.symbols
        frequencySet = trimmedResult.frequencySet ?? frequencySet
      }
    }

    if ((!frame || !frame.isValid) && !extractorAttemptedOriginal) {
      const fullResult = await runSymbolExtractor(originalData)
      extractorAttemptedOriginal = true

      if (fullResult) {
        frame = fullResult.frame
        symbols = fullResult.symbols
        frequencySet = fullResult.frequencySet ?? frequencySet
      }
    }
  }

  const effectiveStartTime =
    startTime !== null
      ? startTime + leadPaddingMs
      : leadPaddingMs > 0
        ? leadPaddingMs
        : null

  return {
    frame,
    symbols,
    frequencySet,
    startTime: effectiveStartTime,
  }
}
