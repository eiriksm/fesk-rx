<script>
  import AudioUpload from './components/AudioUpload.svelte'
  import MicrophoneRecorder from './components/MicrophoneRecorder.svelte'
  import WaveformVisualizer from './components/WaveformVisualizer.svelte'
  import DecodingResults from './components/DecodingResults.svelte'
  import SymbolStream from './components/SymbolStream.svelte'
  import StatusPanel from './components/StatusPanel.svelte'

  let audioFile = null
  let audioData = null
  let decodingResults = null
  let symbolStream = []
  let decodingStatus = 'idle' // idle, processing, completed, error
  let statusMessage = 'Ready to decode FESK audio files or listen for real-time transmissions'
  let progress = 0
  let decodeStartedAt = 0
  let decodeDurationMs = null

  function getTimestamp() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  function formatDuration(ms) {
    if (!ms) return ''
    return `${(ms / 1000).toFixed(2)}s`
  }

  function handleAudioFile(event) {
    audioFile = event.detail.file
    audioData = event.detail.audioData
    decodingResults = null
    symbolStream = []
    decodingStatus = 'idle'
    statusMessage = `Loaded ${audioFile.name} - automatically decoding...`
    decodeDurationMs = null
    decodeStartedAt = 0
  }

  function handleDecodeStart() {
    decodingStatus = 'processing'
    statusMessage = 'Decoding FESK transmission...'
    progress = 0
    decodeStartedAt = getTimestamp()
    decodeDurationMs = null
  }

  function handleDecodeProgress(event) {
    progress = event.detail.progress
    statusMessage = `Decoding... ${Math.round(progress)}%`
  }

  function handleDecodeComplete(event) {
    decodingResults = event.detail.results
    symbolStream = event.detail.symbols
    decodingStatus = 'completed'
    decodeDurationMs = decodeStartedAt ? getTimestamp() - decodeStartedAt : null
    const durationLabel = decodeDurationMs ? ` (took ${formatDuration(decodeDurationMs)})` : ''

    const frequencyLabel = decodingResults.frequencySet ? ` via ${decodingResults.frequencySet}` : ''

    statusMessage = decodingResults.frame ?
      `Successfully decoded: "${new TextDecoder().decode(decodingResults.frame.payload)}"${frequencyLabel}${durationLabel}` :
      `Decoding completed but no valid frame found${frequencyLabel}${durationLabel}`
  }

  function handleDecodeError(event) {
    decodingStatus = 'error'
    decodeDurationMs = decodeStartedAt ? getTimestamp() - decodeStartedAt : null
    const durationLabel = decodeDurationMs ? ` after ${formatDuration(decodeDurationMs)}` : ''
    statusMessage = `Decoding failed${durationLabel}: ${event.detail.error}`
  }

  // Microphone event handlers
  function handleMicError(event) {
    decodingStatus = 'error'
    statusMessage = `Microphone error: ${event.detail.error}`
  }

  function handleRecordingComplete(event) {
    // Treat recorded audio as uploaded file for waveform display
    audioFile = event.detail.file
    audioData = event.detail.audioData
    statusMessage = `Recording completed - automatically decoding...`
    decodeDurationMs = null
    decodeStartedAt = 0
  }
</script>

<main class="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
  <!-- Header -->
  <header class="bg-white shadow-sm border-b border-gray-200">
    <div class="max-w-6xl mx-auto px-4 py-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-bold text-gray-900">FESK Audio Decoder</h1>
          <p class="text-gray-600 mt-1">Frequency Shift Keying Signal Analysis</p>
        </div>
        <div class="flex items-center space-x-2">
          <div class="freq-indicator freq-1200"></div>
          <span class="text-sm text-gray-600">2794 Hz (F7)</span>
          <div class="freq-indicator freq-1600"></div>
          <span class="text-sm text-gray-600">3520 Hz (A7)</span>
          <div class="freq-indicator freq-2000"></div>
          <span class="text-sm text-gray-600">4699 Hz (D8)</span>
        </div>
      </div>
    </div>
  </header>

  <div class="max-w-6xl mx-auto px-4 py-8">
    <!-- Status Panel -->
    <StatusPanel
      status={decodingStatus}
      message={statusMessage}
      progress={progress}
    />

    <!-- Main Grid Layout -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
      <!-- Left Column -->
      <div class="space-y-6">
        <!-- Audio Upload -->
        <AudioUpload
          on:fileLoaded={handleAudioFile}
          on:decodeStart={handleDecodeStart}
          on:decodeProgress={handleDecodeProgress}
          on:decodeComplete={handleDecodeComplete}
          on:decodeError={handleDecodeError}
          disabled={decodingStatus === 'processing'}
        />

        <!-- Microphone Input -->
        <MicrophoneRecorder
          on:micError={handleMicError}
          on:recordingComplete={handleRecordingComplete}
          on:decodeStart={handleDecodeStart}
          on:decodeComplete={handleDecodeComplete}
          on:decodeError={handleDecodeError}
          disabled={decodingStatus === 'processing'}
        />

        <!-- Waveform Visualizer -->
        {#if audioData}
          <WaveformVisualizer
            {audioData}
            symbols={symbolStream}
            isDecoding={decodingStatus === 'processing'}
          />
        {/if}
      </div>

      <!-- Right Column -->
      <div class="space-y-6">

        <!-- Symbol Stream -->
        {#if symbolStream.length > 0}
          <SymbolStream symbols={symbolStream} />
        {/if}

        <!-- Decoding Results -->
        {#if decodingResults}
          <DecodingResults results={decodingResults} durationMs={decodeDurationMs} />
        {/if}
      </div>
    </div>

    <!-- Info Section -->
    <div class="mt-12 card">
      <div class="card-header">
        <h2 class="text-xl font-semibold text-gray-900">About FESK Decoding</h2>
      </div>
      <div class="card-body">
        <div class="prose prose-gray max-w-none">
          <p>
            This application decodes Frequency Shift Keying (FESK) audio transmissions using three tone frequencies:
          </p>
          <ul class="list-disc pl-6 mt-4 space-y-2">
            <li><strong class="text-fesk-blue">2793.83 Hz (F7)</strong> - Symbol 0</li>
            <li><strong class="text-fesk-cyan">3520.0 Hz (A7)</strong> - Symbol 1</li>
            <li><strong class="text-fesk-emerald">4698.63 Hz (D8)</strong> - Symbol 2</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
      'Ubuntu', 'Cantarell', 'Open Sans', 'Helvetica Neue', sans-serif;
  }
</style>
