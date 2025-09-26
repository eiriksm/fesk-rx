<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte'
  import { audioBufferToWav } from '../utils/audio'

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
          sampleRate: 48000,
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

        const channelData = audioBuffer.getChannelData(0)
        const monoData = new Float32Array(channelData.length)
        monoData.set(channelData)

        const audioData = {
          data: monoData,
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
    if (isDecoding) return
    isDecoding = true
    dispatch('decodeStart')

    try {
      const { decodeWithDefaultPipeline } = await import('../utils/decodePipeline')
      const result = await decodeWithDefaultPipeline(audioData.data, audioData.sampleRate, {
        preferExtractor: audioData.sampleRate >= 47000,
      })

      const results = {
        frame: result.frame,
        startTime: result.startTime,
        preambleValid: result.frame ? true : false,
        syncValid: result.frame ? true : false,
        frequencySet: result.frequencySet,
      }

      dispatch('decodeComplete', {
        results,
        symbols: result.symbols,
      })

    } catch (error) {
      console.error('Auto-decode error:', error)
      dispatch('decodeError', { error: error.message })
    } finally {
      isDecoding = false
    }
  }

  async function retryDecode() {
    if (!lastRecordedAudio) {
      dispatch('decodeError', { error: 'No recorded audio available for retry' })
      return
    }
    await startAutoDecode(lastRecordedAudio)
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
      recordingInterval = null
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

    <div class="space-y-3">
      <div class="flex items-center justify-between p-4 bg-emerald-50 rounded-lg">
        <div>
          <h3 class="font-medium text-emerald-900">Record & Decode FESK Audio</h3>
          <p class="text-sm text-emerald-700">
            {#if isRecording}
              Recording... {recordingTime.toFixed(1)}s - Audio will be automatically decoded when stopped
            {:else if isDecoding}
              🔄 Decoding audio...
            {:else}
              Click to start recording. Stop to automatically decode the recorded audio
            {/if}
          </p>
        </div>
        <button
          data-test-id="toggle-record"
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

      {#if lastRecordedAudio && !isRecording}
        <div class="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div>
            <h4 class="font-medium text-blue-900">Retry Decoding</h4>
            <p class="text-sm text-blue-700">
              Try decoding the last recording again
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

    {#if isRecording}
      <div class="bg-red-100 border border-red-300 rounded-lg p-3">
        <div class="flex items-center space-x-2">
          <div class="animate-pulse w-2 h-2 bg-red-500 rounded-full"></div>
          <span class="text-red-800 text-sm font-medium">Recording audio... {recordingTime.toFixed(1)}s</span>
        </div>
      </div>
    {/if}

    <div class="text-sm text-gray-600 space-y-2">
      <p><strong>How to use:</strong> Click "Start Recording", play or speak your FESK audio, then click "Stop & Decode".</p>
      <p><strong>Auto-decode:</strong> Audio is processed with the same pipeline used for uploaded WAV files.</p>
      <p><strong>Retry:</strong> If decoding fails or you want to try again, use the "Retry Decode" button.</p>
      <p class="text-xs text-gray-500">Note: Requires microphone permission from your browser.</p>
    </div>
  </div>
</div>
