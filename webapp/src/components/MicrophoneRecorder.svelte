<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte'

  const dispatch = createEventDispatcher()

  export let disabled = false

  let isRecording = false
  let isListening = false
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

  // Real-time detection variables
  let realTimeDecoder = null
  let processingBuffer = []
  let bufferSize = 4410 // 100ms at 44.1kHz
  let lastProcessTime = 0

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
    if (!mediaStream) {
      const success = await requestMicrophoneAccess()
      if (!success) return
    }

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
    isRecording = false
    dispatch('recordingStopped')
  }

  async function startListening() {
    if (!mediaStream) {
      const success = await requestMicrophoneAccess()
      if (!success) return
    }

    // Import FESK decoder for real-time processing
    try {
      const { FeskDecoder } = await import('@fesk/feskDecoder')
      realTimeDecoder = new FeskDecoder()
    } catch (error) {
      console.error('Failed to load FESK decoder:', error)
      dispatch('micError', { error: 'Failed to load decoder for real-time processing' })
      return
    }

    isListening = true
    processingBuffer = []
    lastProcessTime = Date.now()

    // Set up ScriptProcessorNode for real-time processing
    const scriptProcessor = audioContext.createScriptProcessor(1024, 1, 1)

    scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
      if (!isListening) return

      const inputBuffer = audioProcessingEvent.inputBuffer
      const inputData = inputBuffer.getChannelData(0)

      // Add to processing buffer
      processingBuffer.push(...inputData)

      // Process when we have enough samples (every 100ms worth)
      if (processingBuffer.length >= bufferSize) {
        const processChunk = processingBuffer.splice(0, bufferSize)
        processRealtimeAudio(new Float32Array(processChunk))
      }
    }

    microphoneSource.connect(scriptProcessor)
    scriptProcessor.connect(audioContext.destination)

    startVolumeMonitoring()
    dispatch('listeningStarted')
  }

  async function processRealtimeAudio(audioChunk) {
    if (!realTimeDecoder) return

    try {
      // Try to find transmission start
      const startTime = realTimeDecoder.findTransmissionStart(audioChunk, audioContext.sampleRate, 0.005) // Lower threshold for real-time

      if (startTime !== null) {
        dispatch('transmissionDetected', {
          startTime,
          timestamp: Date.now()
        })

        // Try to decode the chunk
        const frame = await realTimeDecoder.processAudioComplete(
          audioChunk,
          audioContext.sampleRate,
          50 // Faster processing for real-time
        )

        if (frame && frame.isValid) {
          dispatch('realtimeDecoded', {
            frame,
            message: new TextDecoder().decode(frame.payload),
            timestamp: Date.now()
          })
        }
      }
    } catch (error) {
      // Silent fail for real-time processing
      console.debug('Real-time decode attempt failed:', error.message)
    }
  }

  function stopListening() {
    isListening = false
    stopVolumeMonitoring()
    dispatch('listeningStopped')
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
    isListening = false
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
    <div class="space-y-3">
      <!-- Real-time Listening -->
      <div class="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
        <div>
          <h3 class="font-medium text-blue-900">Real-time FESK Detection</h3>
          <p class="text-sm text-blue-700">Listen for FESK transmissions and decode them instantly</p>
        </div>
        <button
          class="btn {isListening ? 'btn-danger' : 'btn-primary'}"
          on:click={isListening ? stopListening : startListening}
          disabled={disabled || isRecording}
        >
          {#if isListening}
            🔴 Stop Listening
          {:else}
            🎧 Start Listening
          {/if}
        </button>
      </div>

      <!-- Recording -->
      <div class="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
        <div>
          <h3 class="font-medium text-emerald-900">Record Audio</h3>
          <p class="text-sm text-emerald-700">
            {#if isRecording}
              Recording... {recordingTime.toFixed(1)}s
            {:else}
              Capture audio for offline processing
            {/if}
          </p>
        </div>
        <button
          class="btn {isRecording ? 'btn-danger' : 'btn-success'}"
          on:click={isRecording ? stopRecording : startRecording}
          disabled={disabled || isListening}
        >
          {#if isRecording}
            ⏹️ Stop Recording
          {:else}
            🎙️ Start Recording
          {/if}
        </button>
      </div>
    </div>

    <!-- Status Messages -->
    {#if isListening}
      <div class="bg-blue-100 border border-blue-300 rounded-lg p-3">
        <div class="flex items-center space-x-2">
          <div class="animate-pulse w-2 h-2 bg-blue-500 rounded-full"></div>
          <span class="text-blue-800 text-sm font-medium">Listening for FESK transmissions...</span>
        </div>
      </div>
    {/if}

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
      <p><strong>Real-time Mode:</strong> Automatically detects and decodes FESK transmissions as they arrive.</p>
      <p><strong>Recording Mode:</strong> Captures audio to file for detailed offline analysis.</p>
      <p class="text-xs text-gray-500">Note: Both modes require microphone permission from your browser.</p>
    </div>
  </div>
</div>