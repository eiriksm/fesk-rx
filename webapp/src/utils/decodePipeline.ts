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

      const duration = data.length / sampleRate
      const startTimeRange = {
        start: 0,
        end: Math.max(0.05, Math.min(duration, Math.max(0.5, duration * 0.75))),
        step: 0.02,
      }

      const candidate = await decoder.decodeAudioDataWithSymbolExtractor(
        data,
        sampleRate,
        { startTimeRange },
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

  let extractorInput = workingData
  let extractorAttemptedTrimmed = false
  let extractorAttemptedOriginal = workingData === originalData

  if (preferExtractor) {
    const extractorResult = await runSymbolExtractor(workingData)
    extractorAttemptedTrimmed = true
    if (extractorAttemptedOriginal === false && workingData === originalData) {
      extractorAttemptedOriginal = true
    }

    if (extractorResult) {
      frame = extractorResult.frame
      symbols = extractorResult.symbols
      frequencySet = extractorResult.frequencySet ?? frequencySet
    }
  }

  let startTime: number | null = null

  if (!frame) {
    decoder.reset()

    startTime = decoder.findTransmissionStart(workingData, sampleRate)

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
  }

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
