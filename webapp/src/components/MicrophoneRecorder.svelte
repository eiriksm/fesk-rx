<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte'

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

  // Auto-decode after recording
  let autoDecodeEnabled = true

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
      const blob = new Blob(recordedChunks, { type: 'audio/webm' })
      const file = new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' })

      try {
        // Convert to audio buffer for processing
        const arrayBuffer = await blob.arrayBuffer()
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

        const audioData = {
          data: audioBuffer.getChannelData(0),
          sampleRate: audioBuffer.sampleRate,
          duration: audioBuffer.duration
        }

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

    // Close audio context
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close()
      audioContext = null
    }

    isRecording = false
    dispatch('recordingStopped')
  }

  async function startAutoDecode(audioData) {
    dispatch('decodeStart')

    try {
      // Import FESK decoder
      const { FeskDecoder } = await import('@fesk/feskDecoder')
      const decoder = new FeskDecoder()

      // Try to find transmission start
      const startTime = decoder.findTransmissionStart(audioData.data, audioData.sampleRate)

      let frame = null
      let symbols = []

      if (startTime !== null) {
        // Process audio from detected start
        const startSeconds = startTime / 1000
        const offsetData = audioData.data.slice(Math.floor(startSeconds * audioData.sampleRate))

        frame = await decoder.processAudioComplete(offsetData, audioData.sampleRate, 100)

        // Extract symbols for visualization
        const audioSample = {
          data: offsetData,
          sampleRate: audioData.sampleRate,
          duration: offsetData.length / audioData.sampleRate
        }
        symbols = decoder.toneDetector.extractSymbols(audioSample, 0)
      } else {
        // Try processing entire audio
        frame = await decoder.processAudioComplete(audioData.data, audioData.sampleRate, 100)

        // Extract symbols from full audio
        const audioSample = {
          data: audioData.data,
          sampleRate: audioData.sampleRate,
          duration: audioData.data.length / audioData.sampleRate
        }
        symbols = decoder.toneDetector.extractSymbols(audioSample, 0)
      }

      const results = {
        frame,
        startTime,
        preambleValid: frame ? true : false,
        syncValid: frame ? true : false
      }

      dispatch('decodeComplete', { results, symbols })

    } catch (error) {
      console.error('Auto-decode error:', error)
      dispatch('decodeError', { error: error.message })
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

    <!-- Recording Controls -->
    <div class="flex items-center justify-between p-4 bg-emerald-50 rounded-lg">
      <div>
        <h3 class="font-medium text-emerald-900">Record & Decode FESK Audio</h3>
        <p class="text-sm text-emerald-700">
          {#if isRecording}
            Recording... {recordingTime.toFixed(1)}s - Audio will be automatically decoded when stopped
          {:else}
            Click to start recording. Stop to automatically decode the recorded audio
          {/if}
        </p>
      </div>
      <button
        class="btn {isRecording ? 'btn-danger' : 'btn-success'} btn-large"
        on:click={isRecording ? stopRecording : startRecording}
        disabled={disabled}
      >
        {#if isRecording}
          ⏹️ Stop & Decode
        {:else}
          🎙️ Start Recording
        {/if}
      </button>
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
      <p><strong>Auto-decode:</strong> Audio will be automatically processed and decoded when recording stops.</p>
      <p class="text-xs text-gray-500">Note: Requires microphone permission from your browser.</p>
    </div>
  </div>
</div>