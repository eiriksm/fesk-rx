<script>
  import { createEventDispatcher } from 'svelte'
  import { trimSilence } from '../utils/audio'

  const dispatch = createEventDispatcher()

  export let disabled = false

  let fileInput
  let dragOver = false
  let audioFile = null
  let audioContext = null
  let audioBuffer = null

  async function handleFileSelect(file) {
    if (!file || !file.type.startsWith('audio/')) {
      dispatch('decodeError', { error: 'Please select a valid audio file' })
      return
    }

    audioFile = file

    try {
      // Create audio context
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)()
      }

      // Read file as array buffer
      const arrayBuffer = await file.arrayBuffer()
      audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

      // Convert to Float32Array for our decoder
      const channelData = audioBuffer.getChannelData(0) // Use first channel
      const audioData = {
        data: channelData,
        sampleRate: audioBuffer.sampleRate,
        duration: audioBuffer.duration
      }

      dispatch('fileLoaded', { file, audioData })

      // Automatically start decoding
      setTimeout(() => startDecoding(), 100)
    } catch (error) {
      console.error('Error loading audio file:', error)
      dispatch('decodeError', { error: `Failed to load audio: ${error.message}` })
    }
  }

  function handleFileInputChange(event) {
    const file = event.target.files[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  function handleDrop(event) {
    event.preventDefault()
    dragOver = false
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) {
      handleFileSelect(files[0])
    }
  }

  function handleDragOver(event) {
    event.preventDefault()
    dragOver = true
  }

  function handleDragLeave() {
    dragOver = false
  }

  async function startDecoding() {
    if (!audioBuffer) return

    dispatch('decodeStart')

    try {
      // Import our FESK decoder
      const { FeskDecoder } = await import('@fesk/feskDecoder')
      const decoder = new FeskDecoder()

      // Convert audio buffer to the format expected by our decoder
      const originalData = audioBuffer.getChannelData(0)
      const { data: trimmedData, leadPaddingMs } = trimSilence(originalData, audioBuffer.sampleRate)

      const workingData = trimmedData.length > 0 ? trimmedData : originalData
      const preferExtractor = audioBuffer.sampleRate >= 47000

      const buildSample = data => ({
        data,
        sampleRate: audioBuffer.sampleRate,
        duration: data.length / audioBuffer.sampleRate
      })

      const runSymbolExtractor = async data => {
        if (!data || data.length === 0) return null
        try {
          decoder.reset()

          const duration = data.length / audioBuffer.sampleRate
          const startTimeRange = {
            start: 0,
            end: Math.max(0.05, Math.min(duration, Math.max(0.5, duration * 0.75))),
            step: 0.02
          }

          const candidate = await decoder.decodeAudioDataWithSymbolExtractor(
            data,
            audioBuffer.sampleRate,
            { startTimeRange }
          )

          if (!candidate) return null

          const info = decoder.getLastSymbolExtractorInfo()
          return {
            frame: candidate,
            symbols: decoder.toneDetector.extractSymbols(buildSample(data), 0),
            frequencySet: info?.frequencySet ?? null
          }
        } catch (error) {
          console.error('Symbol extractor attempt failed:', error)
          return null
        }
      }

      let frame = null
      let symbols = []
      let frequencySet = null

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

      let startTime = null

      if (!frame) {
        decoder.reset()

        startTime = decoder.findTransmissionStart(workingData, audioBuffer.sampleRate)

        if (startTime !== null) {
          let decodeStartMs = startTime

          if (audioBuffer.sampleRate >= 47000) {
            decodeStartMs += 300
          }

          const startSeconds = decodeStartMs / 1000
          const offsetIndex = Math.floor(startSeconds * audioBuffer.sampleRate)
          const offsetData = workingData.slice(offsetIndex)

          extractorInput = offsetData

          frame = await decoder.processAudioComplete(
            offsetData,
            audioBuffer.sampleRate,
            100
          )

          symbols = decoder.toneDetector.extractSymbols(buildSample(offsetData), 0)
        } else {
          frame = await decoder.processAudioComplete(
            workingData,
            audioBuffer.sampleRate,
            100
          )

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

      const results = {
        frame,
        startTime: effectiveStartTime,
        preambleValid: frame ? true : false,
        syncValid: frame ? true : false,
        frequencySet
      }

      dispatch('decodeComplete', {
        results,
        symbols
      })

    } catch (error) {
      console.error('Decoding error:', error)
      dispatch('decodeError', { error: error.message })
    }
  }

  async function loadSampleFile() {
    try {
      const response = await fetch('/webapp-fesk2.wav')
      const arrayBuffer = await response.arrayBuffer()
      const blob = new Blob([arrayBuffer], { type: 'audio/wav' })

      // Create a File object from the blob
      const file = new File([blob], 'webapp-fesk2.wav', { type: 'audio/wav' })

      await handleFileSelect(file)
    } catch (error) {
      console.error('Error loading sample file:', error)
      dispatch('decodeError', { error: `Failed to load sample: ${error.message}` })
    }
  }

  function triggerFileDialog() {
    if (!disabled && fileInput) {
      fileInput.click()
    }
  }

  function handleDropZoneKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      triggerFileDialog()
    }
  }
</script>

<div class="card">
  <div class="card-header">
    <h2 class="text-lg font-semibold text-gray-900">Audio File Upload</h2>
  </div>
  <div class="card-body">
    <!-- File Drop Zone -->
    <div
      class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center transition-colors
             {dragOver ? 'border-fesk-blue bg-blue-50' : ''}
             {disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-fesk-blue cursor-pointer'}"
      class:drag-over={dragOver}
      on:drop={handleDrop}
      on:dragover={handleDragOver}
      on:dragleave={handleDragLeave}
      on:click={triggerFileDialog}
      on:keydown={handleDropZoneKeydown}
      role="button"
      tabindex="0"
    >
      <div class="space-y-4">
        <div class="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
          <svg class="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>

        <div>
          <p class="text-lg font-medium text-gray-900">
            {dragOver ? 'Drop your audio file here' : 'Upload FESK Audio File'}
          </p>
          <p class="text-sm text-gray-500 mt-1">
            {audioFile ? `Selected: ${audioFile.name}` : 'Files will be decoded automatically upon upload'}
          </p>
        </div>

        {#if audioFile}
          <div class="text-sm text-gray-600 bg-gray-50 rounded p-3">
            <div class="font-mono">
              <div>File: {audioFile.name}</div>
              <div>Size: {(audioFile.size / 1024 / 1024).toFixed(2)} MB</div>
              {#if audioBuffer}
                <div>Duration: {audioBuffer.duration.toFixed(2)}s</div>
                <div>Sample Rate: {audioBuffer.sampleRate} Hz</div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <input
      bind:this={fileInput}
      type="file"
      accept="audio/*"
      class="hidden"
      on:change={handleFileInputChange}
      {disabled}
    />

    <!-- Action Buttons -->
    <div class="flex space-x-3 mt-6">
      <button
        class="btn btn-primary flex-1"
        on:click={loadSampleFile}
        disabled={disabled}
      >
        📄 Load Sample File
      </button>

      <button
        class="btn btn-secondary"
        on:click={() => {
          audioFile = null
          audioBuffer = null
          if (fileInput) fileInput.value = ''
        }}
        disabled={!audioFile || disabled}
      >
        Clear
      </button>
    </div>
  </div>
</div>

<style>
  .drag-over {
    transform: scale(1.02);
  }
</style>
