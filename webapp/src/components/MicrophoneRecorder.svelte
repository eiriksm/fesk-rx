<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte'
  import { trimSilence, audioBufferToWav } from '../utils/audio'

  const dispatch = createEventDispatcher()

  export let disabled = false

  let isRecording = false
  let mediaStream = null
  let audioContext = null
  let mediaRecorder = null
  let analyzerNode = null
  let microphoneSource = null
  let recordedChunks = []
  let recordingTime = 0
  let recordingInterval = null
  let currentVolume = 0
  let volumeInterval = null
  let downloadUrl = null
  let downloadFilename = ''

  // Auto-decode after recording
  let autoDecodeEnabled = true
  let lastRecordedAudio = null // Store last recorded audio for retry
  let isDecoding = false // Track decoding state

  // Decoding options
  const FAST_SYMBOL_DURATIONS = [0.098, 0.1, 0.102]
  const DEFAULT_FREQUENCY_SET: [number, number, number] = [2793.83, 3520, 4698.63]
  const HARDWARE_FREQUENCY_SET: [number, number, number] = [1200, 1600, 2000]
  const DEFAULT_CHUNK_SIZE = 100

  function revokeDownloadUrl() {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl)
      downloadUrl = null
    }
    downloadFilename = ''
  }

  async function requestMicrophoneAccess() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 44100,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })

      audioContext = new (window.AudioContext || window.webkitAudioContext)()
      microphoneSource = audioContext.createMediaStreamSource(mediaStream)

      // Create analyzer for volume monitoring
      analyzerNode = audioContext.createAnalyser()
      analyzerNode.fftSize = 256
      microphoneSource.connect(analyzerNode)

      return true
    } catch (error) {
      console.error('Error accessing microphone:', error)
      dispatch('micError', { error: error.message })
      return false
    }
  }

  function startVolumeMonitoring() {
    if (!analyzerNode) return

    volumeInterval = setInterval(() => {
      const dataArray = new Uint8Array(analyzerNode.frequencyBinCount)
      analyzerNode.getByteFrequencyData(dataArray)

      // Calculate RMS volume
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i]
      }
      currentVolume = Math.sqrt(sum / dataArray.length) / 255
    }, 50)
  }

  function stopVolumeMonitoring() {
    if (volumeInterval) {
      clearInterval(volumeInterval)
      volumeInterval = null
      currentVolume = 0
    }
  }

  async function startRecording() {
    // Always request fresh microphone access for recording
    const success = await requestMicrophoneAccess()
    if (!success) return

    revokeDownloadUrl()

    recordedChunks = []
    recordingTime = 0
    isRecording = true

    // Set up MediaRecorder
    mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType: 'audio/webm;codecs=opus'
    })

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data)
      }
    }

    mediaRecorder.onstop = async () => {
      const timestamp = Date.now()
      const baseName = `recording-${timestamp}`
      const blob = new Blob(recordedChunks, { type: 'audio/webm' })
      const file = new File([blob], `${baseName}.webm`, { type: 'audio/webm' })

      try {
        // Create a new audio context for processing since we might have closed the old one
        const processingContext = new (window.AudioContext || window.webkitAudioContext)()

        // Convert to audio buffer for processing
        const arrayBuffer = await blob.arrayBuffer()
        const audioBuffer = await processingContext.decodeAudioData(arrayBuffer)

        const audioData = {
          data: audioBuffer.getChannelData(0),
          sampleRate: audioBuffer.sampleRate,
          duration: audioBuffer.duration
        }

        const wavBlob = audioBufferToWav(audioBuffer)
        revokeDownloadUrl()
        downloadFilename = `${baseName}.wav`
        downloadUrl = URL.createObjectURL(wavBlob)

        // Close the processing context
        processingContext.close()

        // Store for retry functionality
        lastRecordedAudio = audioData

        dispatch('recordingComplete', { file, audioData })

        // Automatically start decoding if enabled
        if (autoDecodeEnabled) {
          setTimeout(() => startAutoDecode(audioData), 100)
        }
      } catch (error) {
        console.error('Error processing recording:', error)
        dispatch('micError', { error: `Failed to process recording: ${error.message}` })
      }
    }

    mediaRecorder.start(100) // Collect data every 100ms

    // Start timing
    recordingInterval = setInterval(() => {
      recordingTime += 0.1
    }, 100)

    startVolumeMonitoring()
    dispatch('recordingStarted')
  }

  function stopRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop()
    }

    if (recordingInterval) {
      clearInterval(recordingInterval)
      recordingInterval = null
    }

    stopVolumeMonitoring()

    // Stop the microphone stream
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => {
        track.stop()
        console.log('Stopped microphone track:', track.label)
      })
      mediaStream = null
    }

    // Don't close audio context immediately - let the onstop callback finish first
    // We'll close it after a delay or let the processing context handle it
    setTimeout(() => {
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close()
        audioContext = null
      }
    }, 1000)

    isRecording = false
    dispatch('recordingStopped')
  }

  async function startAutoDecode(audioData) {
    if (isDecoding) return // Prevent multiple concurrent decodes
    isDecoding = true
    dispatch('decodeStart')

    try {
      // Import FESK decoder and configuration
      const { FeskDecoder, DEFAULT_CONFIG } = await import('@fesk/feskDecoder')

      // Try multiple parameter combinations automatically
      const result = await tryMultipleParameterCombinations(audioData, FeskDecoder, DEFAULT_CONFIG)

      if (result.success) {
        const results = {
          frame: result.frame,
          startTime: result.startTime,
          preambleValid: result.frame ? true : false,
          syncValid: result.frame ? true : false,
          usedParameters: result.usedParameters,
          frequencySet: result.frequencySet ?? null
        }

        dispatch('decodeComplete', { results, symbols: result.symbols })
      } else {
        dispatch('decodeError', { error: 'Failed to decode with any parameter combination' })
      }

    } catch (error) {
      console.error('Auto-decode error:', error)
      dispatch('decodeError', { error: error.message })
    } finally {
      isDecoding = false
    }
  }

  // Retry decoding with current settings
  async function retryDecode() {
    if (!lastRecordedAudio) {
      dispatch('decodeError', { error: 'No recorded audio available for retry' })
      return
    }
    await startAutoDecode(lastRecordedAudio)
  }

  // Try multiple parameter combinations automatically
  async function tryMultipleParameterCombinations(audioData, FeskDecoder, DEFAULT_CONFIG) {
    const combinations = [
      // Start with current user settings
      {
        name: 'Current Settings',
        tolerantMode,
        frequencySet,
        useParametricGoertzel,
        useAdvancedTiming,
        useHannWindow,
        chunkSizeMs
      },
      // Try standard combinations
      {
        name: 'Standard + Parametric Goertzel',
        tolerantMode: false,
        frequencySet: 'default',
        useParametricGoertzel: true,
        useAdvancedTiming: false,
        useHannWindow: false,
        chunkSizeMs: 100
      },
      {
        name: 'Standard + Advanced Timing',
        tolerantMode: false,
        frequencySet: 'default',
        useParametricGoertzel: false,
        useAdvancedTiming: true,
        useHannWindow: false,
        chunkSizeMs: 100
      },
      {
        name: 'All Advanced Features',
        tolerantMode: false,
        frequencySet: 'default',
        useParametricGoertzel: true,
        useAdvancedTiming: true,
        useHannWindow: true,
        chunkSizeMs: 100
      },
      // Try tolerant mode combinations
      {
        name: 'Tolerant Mode',
        tolerantMode: true,
        frequencySet: 'default',
        useParametricGoertzel: false,
        useAdvancedTiming: false,
        useHannWindow: false,
        chunkSizeMs: 100
      },
      {
        name: 'Tolerant + Hardware Frequencies',
        tolerantMode: true,
        frequencySet: 'hardware',
        useParametricGoertzel: false,
        useAdvancedTiming: false,
        useHannWindow: false,
        chunkSizeMs: 150
      },
      {
        name: 'Tolerant + All Advanced',
        tolerantMode: true,
        frequencySet: 'default',
        useParametricGoertzel: true,
        useAdvancedTiming: true,
        useHannWindow: true,
        chunkSizeMs: 150
      }
    ]

    for (const combo of combinations) {
      console.log(`Trying combination: ${combo.name}`)

      try {
        // Create decoder with this combination's config
        let config = { ...DEFAULT_CONFIG }
        if (combo.frequencySet === 'hardware') {
          config.toneFrequencies = [1200, 1600, 2000]
        }
        const decoder = new FeskDecoder(config)

        let frame = null
        let symbols = []
        let frequencySetUsed = null

        if (combo.tolerantMode) {
          const result = await tryTolerantDecodeWithParams(audioData, decoder, combo)
          frame = result.frame
          symbols = result.symbols
          frequencySetUsed = result.frequencySet ?? frequencySetUsed
        } else {
          const result = await tryStandardDecodeWithParams(audioData, decoder, combo)
          frame = result.frame
          symbols = result.symbols
          frequencySetUsed = result.frequencySet ?? frequencySetUsed
        }

        // Check if we got a valid result
        if (frame && frame.isValid) {
          console.log(`✅ Success with: ${combo.name}`)
          return {
            success: true,
            frame,
            symbols,
            startTime: result.startTime ?? null,
            usedParameters: combo,
            frequencySet: frequencySetUsed
          }
        }
      } catch (error) {
        console.log(`❌ Failed with ${combo.name}: ${error.message}`)
        continue
      }
    }

    console.log('❌ All parameter combinations failed')
    return { success: false }
  }

  // Helper functions for parameter-specific decoding
  async function tryStandardDecodeWithParams(audioData, decoder, params) {
    return await tryStandardDecode(audioData, decoder, params)
  }

  async function tryTolerantDecodeWithParams(audioData, decoder, params) {
    return await tryTolerantDecode(audioData, decoder, params)
  }

  async function tryStandardDecode(audioData, decoder, params: any = {}) {
    const preferExtractor =
      typeof params.preferExtractor === 'boolean'
        ? params.preferExtractor
        : audioData.sampleRate >= 47000

    const getSymbols = (sample: { data: Float32Array; sampleRate: number }) =>
      decoder.toneDetector.extractSymbols(sample, 0)

    const trimResult = trimSilence(audioData.data, audioData.sampleRate, {
      threshold: 0.0012,
      paddingMs: 150,
      minActiveMs: 60
    })
    const trimmedData = trimResult.data
    const trimmedLeadPaddingMs = trimResult.leadPaddingMs
    const trimmedAvailable = trimmedData.length > 0 && trimmedData.length < audioData.data.length

    const usingTrimmedOverride = Boolean(params.__micUseTrimmed)
    const leadPaddingOverride = params.leadPaddingOverride ?? null
    const trimmedPreferred = trimmedAvailable && trimmedLeadPaddingMs <= 600
    const shouldUseTrimmedInitially = usingTrimmedOverride || trimmedPreferred

    let workingData = shouldUseTrimmedInitially ? trimmedData : audioData.data
    let leadPaddingMs = shouldUseTrimmedInitially
      ? leadPaddingOverride ?? trimmedLeadPaddingMs
      : 0

    const buildSample = data => ({
      data,
      sampleRate: audioData.sampleRate,
      duration: data.length / audioData.sampleRate
    })

    const runSymbolExtractor = async (
      data: Float32Array,
      mode: 'fast' | 'full' = 'full'
    ) => {
      if (!data || data.length === 0) return null
      try {
        decoder.reset()

        const duration = data.length / audioData.sampleRate
        const fastRange = {
          start: 0,
          end: Math.max(0.3, Math.min(duration, 1.2)),
          step: 0.04
        }
        const fullRange = {
          start: 0,
          end: Math.max(0.05, Math.min(duration, Math.max(0.5, duration * 0.75))),
          step: 0.02
        }

        const startTimeRange = mode === 'fast' ? fastRange : fullRange

        const useLowSampleRate = audioData.sampleRate <= 46000

        const fastFrequencySets = useLowSampleRate
          ? [
              { name: 'hardware-fast', tones: HARDWARE_FREQUENCY_SET },
              { name: 'default-fast', tones: DEFAULT_FREQUENCY_SET }
            ]
          : [{ name: 'default-fast', tones: DEFAULT_FREQUENCY_SET }]

        const fastCandidateOffsets = useLowSampleRate
          ? [0, -0.02, 0.02, -0.015, 0.015, -0.01, 0.01]
          : [0, -0.015, 0.015, -0.01, 0.01, -0.005, 0.005]

        const extractorOptions =
          mode === 'fast'
            ? {
                startTimeRange,
                frequencySets: fastFrequencySets,
                symbolDurations: FAST_SYMBOL_DURATIONS,
                candidateOffsets: fastCandidateOffsets,
                minConfidence: useLowSampleRate ? 0.08 : 0.12
              }
            : { startTimeRange }

        const candidate = await decoder.decodeAudioDataWithSymbolExtractor(
          data,
          audioData.sampleRate,
          extractorOptions
        )

        if (!candidate) return null

        const sample = buildSample(data)
        const info = decoder.getLastSymbolExtractorInfo()
        return {
          frame: candidate,
          symbols: getSymbols(sample),
          frequencySet: info?.frequencySet ?? null
        }
      } catch (error) {
        console.error('Microphone extractor attempt failed:', error)
        return null
      }
    }

    let frame = null
    let symbols = []
    let frequencySet = null
    let extractorInput = workingData
    let extractorAttemptedTrimmed = false
    let extractorAttemptedOriginal = false
    let startTimeDetected = null

    const fastExtractor = await runSymbolExtractor(workingData, 'fast')
    if (fastExtractor) {
      return {
        frame: fastExtractor.frame,
        symbols: fastExtractor.symbols,
        startTime: leadPaddingMs > 0 ? leadPaddingMs : null,
        frequencySet: fastExtractor.frequencySet ?? null
      }
    }

    if (workingData === trimmedData) {
      extractorAttemptedTrimmed = true
    } else {
      extractorAttemptedOriginal = true
    }

    if (preferExtractor) {
      const extractorResult = await runSymbolExtractor(workingData)
      if (workingData === trimmedData) {
        extractorAttemptedTrimmed = true
      } else {
        extractorAttemptedOriginal = true
      }

      if (extractorResult) {
        frame = extractorResult.frame
        symbols = extractorResult.symbols
        frequencySet = extractorResult.frequencySet ?? frequencySet
      }
    }

    if (!frame) {
      decoder.reset()
      startTimeDetected = decoder.findTransmissionStart(workingData, audioData.sampleRate)

      if (startTimeDetected !== null) {
        let decodeStartMs = startTimeDetected
        if (audioData.sampleRate >= 47000) {
          decodeStartMs += 300
        }

        const startSeconds = decodeStartMs / 1000
        const offsetIndex = Math.floor(startSeconds * audioData.sampleRate)
        const offsetData = workingData.slice(offsetIndex)

        extractorInput = offsetData

        const currentChunkSize = params.chunkSizeMs || chunkSizeMs
        frame = await decoder.processAudioComplete(offsetData, audioData.sampleRate, currentChunkSize)

        symbols = getSymbols(buildSample(offsetData))
      } else {
        const currentChunkSize = params.chunkSizeMs || chunkSizeMs
        frame = await decoder.processAudioComplete(workingData, audioData.sampleRate, currentChunkSize)

        extractorInput = workingData
        symbols = getSymbols(buildSample(workingData))
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

      if ((!frame || !frame.isValid) && !extractorAttemptedTrimmed && trimmedAvailable) {
        const trimmedResult = await runSymbolExtractor(trimmedData)
        extractorAttemptedTrimmed = true

        if (trimmedResult) {
          frame = trimmedResult.frame
          symbols = trimmedResult.symbols
          frequencySet = trimmedResult.frequencySet ?? frequencySet
          workingData = trimmedData
          leadPaddingMs = trimmedLeadPaddingMs
          extractorInput = trimmedData
          startTimeDetected = null
        }
      }

      if ((!frame || !frame.isValid) && !extractorAttemptedOriginal) {
        const fullResult = await runSymbolExtractor(audioData.data)
        extractorAttemptedOriginal = true

        if (fullResult) {
          frame = fullResult.frame
          symbols = fullResult.symbols
          frequencySet = fullResult.frequencySet ?? frequencySet
          workingData = audioData.data
          leadPaddingMs = 0
          extractorInput = audioData.data
          startTimeDetected = null
        }
      }
    }

    if ((!frame || !frame.isValid) && trimmedAvailable && !shouldUseTrimmedInitially) {
      const trimmedAudioData = {
        ...audioData,
        data: trimmedData,
        duration: trimmedData.length / audioData.sampleRate
      }

      return await tryStandardDecode(trimmedAudioData, decoder, {
        ...params,
        __micUseTrimmed: true,
        leadPaddingOverride: trimmedLeadPaddingMs
      })
    }

    const adjustedStartTime =
      startTimeDetected !== null
        ? startTimeDetected + leadPaddingMs
        : leadPaddingMs > 0
          ? leadPaddingMs
          : null

    return { frame, symbols, startTime: adjustedStartTime, frequencySet }
  }

  async function tryTolerantDecode(audioData, decoder, params = {}) {
    // Implementation based on integration test tolerant validation
    const { CanonicalTritDecoder } = await import('@fesk/utils/canonicalTritDecoder')

    const trimResult = trimSilence(audioData.data, audioData.sampleRate, {
      threshold: 0.0012,
      paddingMs: 150,
      minActiveMs: 60
    })
    const trimmedData = trimResult.data
    const trimmedLeadPaddingMs = trimResult.leadPaddingMs
    const trimmedAvailable = trimmedData.length > 0 && trimmedData.length < audioData.data.length
    const overrideProvided = Object.prototype.hasOwnProperty.call(params, 'leadPaddingOverride')
    const leadPaddingOverride = overrideProvided ? params.leadPaddingOverride : null
    const trimmedPreferred = trimmedAvailable && trimmedLeadPaddingMs <= 600
    const useTrimmed = overrideProvided ? true : trimmedPreferred

    const workingData = useTrimmed ? trimmedData : audioData.data
    const leadPaddingMs = useTrimmed
      ? (leadPaddingOverride ?? trimmedLeadPaddingMs)
      : (leadPaddingOverride ?? 0)

    decoder.reset()

    const extractorFrame = await decoder.decodeAudioDataWithSymbolExtractor(
      workingData,
      audioData.sampleRate
    )

    if (extractorFrame && extractorFrame.isValid) {
      const info = decoder.getLastSymbolExtractorInfo()
      const fallbackSample = {
        data: workingData,
        sampleRate: audioData.sampleRate,
        duration: workingData.length / audioData.sampleRate
      }
      const symbols = decoder.toneDetector.extractSymbols(fallbackSample, 0)

      return {
        frame: extractorFrame,
        symbols,
        startTime: leadPaddingMs > 0 ? leadPaddingMs : null,
        frequencySet: info?.frequencySet ?? null
      }
    }

    // Try multiple timing approaches like in the integration tests
    const testStartTimes = [0.6, 1.0, 1.5, 2.0] // Different possible start times in seconds
    const symbolDurations = [98, 100, 102] // Different symbol durations to try

    for (const startTime of testStartTimes) {
      for (const symbolDurationMs of symbolDurations) {
        try {
          const startSample = Math.floor(startTime * audioData.sampleRate)
          if (startSample >= workingData.length) continue

          const offsetData = workingData.slice(startSample)
          const audioSample = {
            data: offsetData,
            sampleRate: audioData.sampleRate,
            duration: offsetData.length / audioData.sampleRate
          }

          // Extract symbols with this timing
          let symbols
          const useAdvanced = params.useAdvancedTiming || params.useParametricGoertzel || params.useHannWindow
          if (useAdvanced) {
            symbols = decoder.toneDetector.extractSymbolsAdvanced(audioSample, {
              useParametricGoertzel: params.useParametricGoertzel || false,
              useHannWindow: params.useHannWindow || false,
              timingSearchWindow: params.useAdvancedTiming ? Math.floor(decoder.config.symbolDuration * audioData.sampleRate * 0.1) : 0
            })
          } else {
            symbols = decoder.toneDetector.extractSymbols(audioSample, 0)
          }

          if (symbols.length < 50) continue // Need reasonable symbol count

          // Try tolerant validation similar to integration tests
          const result = await tryTolerantSymbolDecode(symbols)
          if (result.success) {
            return {
              frame: result.frame,
              symbols,
              startTime: startTime * 1000 + leadPaddingMs,
              frequencySet: decoder.getLastSymbolExtractorInfo()?.frequencySet ?? null
            }
          }
        } catch (error) {
          // Continue trying other combinations
          continue
        }
      }
    }

    // If no tolerant decode worked, fall back to standard
    const standard = await tryStandardDecode(
      {
        ...audioData,
        data: workingData,
        duration: workingData.length / audioData.sampleRate
      },
      decoder,
      params
    )

    if (standard && standard.frequencySet == null) {
      const info = decoder.getLastSymbolExtractorInfo()
      if (info) {
        standard.frequencySet = info.frequencySet
      }
    }

    if ((!standard || !standard.frame || !standard.frame.isValid) && trimmedAvailable && !useTrimmed) {
      const trimmedAudioData = {
        ...audioData,
        data: trimmedData,
        duration: trimmedData.length / audioData.sampleRate
      }

      return await tryTolerantDecode(trimmedAudioData, decoder, {
        ...params,
        leadPaddingOverride: trimmedLeadPaddingMs
      })
    }

    return standard
  }

  async function tryTolerantSymbolDecode(symbols) {
    try {
      const { CanonicalTritDecoder } = await import('@fesk/utils/canonicalTritDecoder')
      const { LFSRDescrambler } = await import('@fesk/utils/lfsrDescrambler')

      // Check preamble with tolerant thresholds (from integration tests)
      const expectedPreamble = [2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0]
      const preambleSymbols = symbols.slice(0, 12)
      let preambleMatches = 0
      for (let i = 0; i < Math.min(expectedPreamble.length, preambleSymbols.length); i++) {
        if (expectedPreamble[i] === preambleSymbols[i]) preambleMatches++
      }
      const preambleScore = preambleMatches / expectedPreamble.length

      if (preambleScore < 0.15) return { success: false } // Very tolerant threshold

      // Try sync detection with flexible positioning
      const barker13 = [2, 2, 2, 2, 2, 0, 0, 2, 2, 0, 2, 0, 2]
      let bestSyncScore = 0
      let syncPosition = 12

      for (let pos = 10; pos <= 14 && pos + 13 <= symbols.length; pos++) {
        const syncSlice = symbols.slice(pos, pos + 13)
        let syncMatches = 0
        for (let i = 0; i < barker13.length; i++) {
          if (barker13[i] === syncSlice[i]) syncMatches++
        }
        const syncScore = syncMatches / barker13.length
        if (syncScore > bestSyncScore) {
          bestSyncScore = syncScore
          syncPosition = pos
        }
      }

      if (bestSyncScore < 0.15) return { success: false } // Very tolerant

      // Extract and decode payload
      const payloadStart = syncPosition + 13
      const payloadSymbols = symbols.slice(payloadStart, payloadStart + 25) // Standard 25-symbol payload

      if (payloadSymbols.length < 25) return { success: false }

      // Try differential decoding
      const differentialDecoded = []
      let previous = 1
      for (const symbol of payloadSymbols) {
        const decoded = (symbol - previous + 3) % 3
        differentialDecoded.push(decoded)
        previous = symbol
      }

      const bytes = CanonicalTritDecoder.decode(differentialDecoded)
      if (bytes.length === 0) return { success: false }

      // Try to decode as text - be very tolerant for hardware recordings
      const message = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
      const clean = message.replace(/\0/g, '').replace(/[^\x20-\x7E]/g, '')

      // For hardware recordings, accept if we have some readable content
      const readableChars = (clean.match(/[a-zA-Z0-9]/g) || []).length
      if (readableChars >= 3) {
        return {
          success: true,
          frame: {
            payload: new TextEncoder().encode(clean.trim()),
            isValid: true
          }
        }
      }

      return { success: false }
    } catch (error) {
      return { success: false }
    }
  }


  function cleanup() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop())
      mediaStream = null
    }
    if (audioContext) {
      audioContext.close()
      audioContext = null
    }
    if (recordingInterval) {
      clearInterval(recordingInterval)
    }
    stopVolumeMonitoring()

    isRecording = false
    revokeDownloadUrl()
  }

  onDestroy(cleanup)
</script>

<div class="card">
  <div class="card-header">
    <h2 class="text-lg font-semibold text-gray-900">Microphone Input</h2>
  </div>
  <div class="card-body space-y-4">
    <!-- Volume Meter -->
    {#if mediaStream}
      <div class="bg-gray-100 rounded-lg p-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium text-gray-700">Audio Level</span>
          <span class="text-xs text-gray-500">{Math.round(currentVolume * 100)}%</span>
        </div>
        <div class="w-full bg-gray-300 rounded-full h-2">
          <div
            class="bg-green-500 h-2 rounded-full transition-all duration-100"
            style="width: {currentVolume * 100}%"
            class:bg-yellow-500={currentVolume > 0.7}
            class:bg-red-500={currentVolume > 0.9}
          ></div>
        </div>
      </div>
    {/if}

    <!-- Decoding Options -->
    <div class="bg-gray-50 rounded-lg p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="font-medium text-gray-900">Decoding Options</h3>
        <button
          class="text-sm text-blue-600 hover:text-blue-800"
          on:click={() => showAdvancedOptions = !showAdvancedOptions}
        >
          {showAdvancedOptions ? '🔼 Less' : '🔽 More'}
        </button>
      </div>

      <!-- Tolerant Mode Toggle -->
      <div class="flex items-center space-x-3">
        <input
          type="checkbox"
          id="tolerantMode"
          bind:checked={tolerantMode}
          class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
        />
        <label for="tolerantMode" class="text-sm font-medium text-gray-700">
          Hardware/Mobile Recording Mode
        </label>
        <span class="text-xs text-gray-500 bg-yellow-100 px-2 py-1 rounded">
          🔧 Tolerant validation for real-world recordings
        </span>
      </div>

      {#if showAdvancedOptions}
        <!-- Frequency Set -->
        <div class="space-y-2">
          <label class="text-sm font-medium text-gray-700">Frequency Set</label>
          <select bind:value={frequencySet} class="input w-full text-sm">
            <option value="default">Default (2794/3520/4699 Hz - F7/A7/D8)</option>
            <option value="hardware">Hardware (1200/1600/2000 Hz)</option>
          </select>
        </div>

        <!-- Chunk Size -->
        <div class="space-y-2">
          <label class="text-sm font-medium text-gray-700">Processing Chunk Size</label>
          <select bind:value={chunkSizeMs} class="input w-full text-sm">
            <option value={50}>50ms (Fast, less accurate)</option>
            <option value={100}>100ms (Standard)</option>
            <option value={150}>150ms (Slower, more accurate)</option>
          </select>
        </div>

        <!-- Advanced DSP Options -->
        <div class="border-t border-gray-200 pt-3 space-y-3">
          <h4 class="text-sm font-semibold text-gray-900 flex items-center">
            🔬 Advanced DSP Options
            <span class="ml-2 text-xs bg-red-100 text-red-700 px-2 py-1 rounded">Experimental</span>
          </h4>

          <!-- Parametric Goertzel -->
          <div class="flex items-center space-x-3">
            <input
              type="checkbox"
              id="parametricGoertzel"
              bind:checked={useParametricGoertzel}
              class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label for="parametricGoertzel" class="text-sm text-gray-700">
              Parametric Goertzel (fixes frequency binning mismatch)
            </label>
          </div>

          <!-- Advanced Timing -->
          <div class="flex items-center space-x-3">
            <input
              type="checkbox"
              id="advancedTiming"
              bind:checked={useAdvancedTiming}
              class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label for="advancedTiming" class="text-sm text-gray-700">
              Advanced Timing Search (coarse-to-fine symbol timing)
            </label>
          </div>

          <!-- Hann Window -->
          <div class="flex items-center space-x-3">
            <input
              type="checkbox"
              id="hannWindow"
              bind:checked={useHannWindow}
              class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label for="hannWindow" class="text-sm text-gray-700">
              Use Hann Window (instead of Hamming)
            </label>
          </div>

          <!-- Threshold Controls -->
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-xs text-gray-600">Confidence Threshold</label>
              <input
                type="range"
                min="0.1"
                max="0.8"
                step="0.05"
                bind:value={confidenceThreshold}
                class="w-full"
              />
              <span class="text-xs text-gray-500">{confidenceThreshold}</span>
            </div>
            <div class="space-y-1">
              <label class="text-xs text-gray-600">Strength Threshold</label>
              <input
                type="range"
                min="0.0001"
                max="0.01"
                step="0.0001"
                bind:value={strengthThreshold}
                class="w-full"
              />
              <span class="text-xs text-gray-500">{strengthThreshold.toFixed(4)}</span>
            </div>
          </div>

          <div class="text-xs text-gray-500 bg-yellow-50 border border-yellow-200 rounded p-2">
            ⚠️ These experimental options implement the DSP improvements suggested for fixing Goertzel binning issues and symbol timing drift. Use with problematic recordings.
          </div>
        </div>
      {/if}
    </div>

    <!-- Recording Controls -->
    <div class="space-y-3">
      <div class="flex items-center justify-between p-4 bg-emerald-50 rounded-lg">
        <div>
          <h3 class="font-medium text-emerald-900">Record & Decode FESK Audio</h3>
          <p class="text-sm text-emerald-700">
            {#if isRecording}
              Recording... {recordingTime.toFixed(1)}s - Audio will be automatically decoded when stopped
            {:else if isDecoding}
              🔄 Decoding audio, trying multiple parameter combinations...
            {:else if tolerantMode}
              🔧 Tolerant mode enabled - better for hardware/mobile recordings
            {:else}
              Click to start recording. Stop to automatically decode the recorded audio
            {/if}
          </p>
        </div>
        <button
          class="btn {isRecording ? 'btn-danger' : 'btn-success'} btn-large"
          on:click={isRecording ? stopRecording : startRecording}
          disabled={disabled || isDecoding}
        >
          {#if isRecording}
            ⏹️ Stop & Decode
          {:else}
            🎙️ Start Recording
          {/if}
        </button>
      </div>

      <!-- Retry Controls -->
      {#if lastRecordedAudio && !isRecording}
        <div class="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div>
            <h4 class="font-medium text-blue-900">Retry Decoding</h4>
            <p class="text-sm text-blue-700">
              Try decoding the last recording again with different settings
            </p>
          </div>
          <button
            class="btn btn-primary"
            on:click={retryDecode}
            disabled={disabled || isDecoding}
          >
            {#if isDecoding}
              🔄 Decoding...
            {:else}
              🔄 Retry Decode
            {/if}
          </button>
        </div>
      {/if}

      {#if downloadUrl}
        <div class="flex items-center justify-between p-3 bg-purple-50 rounded-lg border border-purple-200">
          <div>
            <h4 class="font-medium text-purple-900">Download Recording</h4>
            <p class="text-sm text-purple-700">
              Save the most recent capture as an uncompressed WAV file
            </p>
          </div>
          <a
            class="btn btn-secondary"
            href={downloadUrl}
            download={downloadFilename || 'recording.wav'}
          >
            ⬇️ Download WAV
          </a>
        </div>
      {/if}
    </div>

    <!-- Status Messages -->
    {#if isRecording}
      <div class="bg-red-100 border border-red-300 rounded-lg p-3">
        <div class="flex items-center space-x-2">
          <div class="animate-pulse w-2 h-2 bg-red-500 rounded-full"></div>
          <span class="text-red-800 text-sm font-medium">Recording audio... {recordingTime.toFixed(1)}s</span>
        </div>
      </div>
    {/if}

    <!-- Instructions -->
    <div class="text-sm text-gray-600 space-y-2">
      <p><strong>How to use:</strong> Click "Start Recording", play or speak your FESK audio, then click "Stop & Decode".</p>
      <p><strong>Auto-decode:</strong> Audio will be automatically processed using multiple parameter combinations until one works.</p>
      <p><strong>Retry:</strong> If decoding fails or you want to try different settings, use the "Retry Decode" button.</p>
      <p class="text-xs text-gray-500">Note: Requires microphone permission from your browser.</p>
    </div>
  </div>
</div>
