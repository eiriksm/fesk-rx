<script>
  import { onMount } from 'svelte'

  const testFiles = [
    {
      name: 'fesk1.wav',
      description: 'Original synthetic FESK transmission',
      expectedMessage: 'test',
      expectedStartTime: 1000,
      tolerance: 200
    },
    {
      name: 'fesk2.wav',
      description: 'Second synthetic test transmission',
      expectedMessage: 'hello world',
      expectedStartTime: 1000,
      tolerance: 200
    },
    {
      name: 'fesk3.wav',
      description: 'Third synthetic test transmission',
      expectedMessage: 'the truth is out there',
      expectedStartTime: 1000,
      tolerance: 200
    },
    {
      name: 'fesk1hw.wav',
      description: 'Hardware recording (44.1kHz)',
      expectedMessage: 'test',
      expectedStartTime: 600,
      tolerance: 300,
      symbolExtractorOptions: {
        frequencySets: [
          {
            name: 'hardware',
            tones: [1200, 1600, 2000]
          }
        ],
        symbolDurations: [0.098, 0.1, 0.102],
        startTimeRange: { start: 0.3, end: 2.5, step: 0.002 },
        symbolsToExtract: 90,
        windowFraction: 0.6,
        minConfidence: 0.08,
        candidateOffsets: [0, -0.02, 0.02, -0.01, 0.01]
      }
    },
    {
      name: 'fesk1mp.wav',
      description: 'Hardware recording (48kHz)',
      expectedMessage: 'test',
      expectedStartTime: 2000,
      tolerance: 300
    },
    {
      name: 'fesk-ut-mobile.wav',
      description: 'Mobile device recording',
      expectedMessage: 'test',
      expectedStartTime: 1000,
      tolerance: 500
    }
  ]

  let testResults = {}
  let isRunningAllTests = false
  let overallResultsVisible = false

  async function runTest(index) {
    const testFile = testFiles[index]
    testResults[index] = { ...testResults[index], testing: true, success: false }

    try {
      const startTime = performance.now()

      // Fetch and process the audio file
      const response = await fetch(testFile.name)
      if (!response.ok) {
        throw new Error(`Failed to load ${testFile.name}: ${response.status}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

      const audioData = {
        data: audioBuffer.getChannelData(0),
        sampleRate: audioBuffer.sampleRate,
        duration: audioBuffer.duration
      }

      // Import and run the FESK decoder
      const { FeskDecoder } = await import('@fesk/feskDecoder')
      const decoder = new FeskDecoder()

      // Try to find transmission start
      const detectedStartTime = decoder.findTransmissionStart(audioData.data, audioData.sampleRate)

      let frame = null
      if (detectedStartTime !== null) {
        const startSeconds = detectedStartTime / 1000
        const offsetData = audioData.data.slice(Math.floor(startSeconds * audioData.sampleRate))
        frame = await decoder.processAudioComplete(offsetData, audioData.sampleRate, 100)
      } else {
        frame = await decoder.processAudioComplete(audioData.data, audioData.sampleRate, 100)
      }

      if (!frame || !frame.isValid) {
        frame = await decoder.decodeWithSymbolExtractor(
          audioData.data,
          audioData.sampleRate,
          testFile.symbolExtractorOptions || {}
        )
      }

      const endTime = performance.now()
      const processingTime = Math.round(endTime - startTime)

      // Validate results
      const decodedMessage = frame ? new TextDecoder().decode(frame.payload) : 'No frame decoded'
      const messageMatches = decodedMessage === testFile.expectedMessage

      let timingMatches = true
      if (detectedStartTime !== null) {
        const timingDiff = Math.abs(detectedStartTime - testFile.expectedStartTime)
        timingMatches = timingDiff <= testFile.tolerance
      }

      const success = messageMatches && timingMatches

      testResults[index] = {
        testing: false,
        success,
        decodedMessage,
        detectedStartTime,
        processingTime,
        expected: testFile.expectedMessage,
        startTimeExpected: testFile.expectedStartTime,
        file: testFile.name
      }

    } catch (error) {
      console.error(`Test failed for ${testFile.name}:`, error)
      testResults[index] = {
        testing: false,
        success: false,
        error: error.message,
        file: testFile.name
      }
    }

    testResults = { ...testResults } // Trigger reactivity
  }

  async function runAllTests() {
    if (isRunningAllTests) return

    isRunningAllTests = true
    testResults = {}
    overallResultsVisible = false

    for (let i = 0; i < testFiles.length; i++) {
      await runTest(i)
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    overallResultsVisible = true
    isRunningAllTests = false
  }

  function getStatusClass(index) {
    const result = testResults[index]
    if (!result) return 'idle'
    if (result.testing) return 'testing'
    return result.success ? 'success' : 'error'
  }

  function getCardClass(index) {
    const status = getStatusClass(index)
    return `test-card ${status === 'idle' ? '' : status}`
  }

  function getButtonClass(index) {
    const result = testResults[index]
    if (!result || result.testing) return 'btn-primary'
    return result.success ? 'btn-success' : 'btn-danger'
  }

  function getButtonText(index) {
    const result = testResults[index]
    if (!result) return '🧪 Test Decode'
    if (result.testing) return '🔄 Testing...'
    return result.success ? '✅ Test Passed' : '❌ Test Failed'
  }

  function formatResult(index) {
    const result = testResults[index]
    if (!result) return ''
    if (result.error) return `ERROR: ${result.error}`

    return `DECODED: "${result.decodedMessage}"
EXPECTED: "${result.expected}"
START TIME: ${result.detectedStartTime}ms (expected ~${result.startTimeExpected}ms)
PROCESSING: ${result.processingTime}ms
MATCH: ${result.success ? 'YES' : 'NO'}`
  }

  function getOverallSummary() {
    const total = Object.keys(testResults).length
    const passed = Object.values(testResults).filter(r => r.success).length
    const failed = total - passed

    let summary = `TOTAL TESTS: ${total}
PASSED: ${passed}
FAILED: ${failed}
SUCCESS RATE: ${Math.round((passed / total) * 100)}%

DETAILED RESULTS:
`

    Object.entries(testResults).forEach(([index, result]) => {
      const testFile = testFiles[parseInt(index)]
      summary += `\n${result.file}: ${result.success ? '✅ PASS' : '❌ FAIL'}`
      if (result.success && result.decodedMessage) {
        summary += ` - "${result.decodedMessage}" (${result.processingTime}ms)`
      }
      if (!result.success && result.error) {
        summary += ` - ${result.error}`
      }
    })

    return summary
  }
</script>

<main class="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-4">
  <div class="max-w-6xl mx-auto">
    <div class="text-center mb-10">
      <h1 class="text-4xl font-bold text-gray-900 mb-4">🔬 FESK Decoder Test Suite</h1>
      <p class="text-lg text-gray-600">Automated testing for FESK audio decoding with expected results</p>
    </div>

    <div class="text-center mb-8">
      <button
        class="btn-large btn-purple"
        on:click={runAllTests}
        disabled={isRunningAllTests}
      >
        {isRunningAllTests ? '🔄 Running All Tests...' : '🚀 Run All Tests'}
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
      {#each testFiles as testFile, index}
        <div class="card {getCardClass(index)}">
          <div class="flex items-center mb-3">
            <div class="status-indicator status-{getStatusClass(index)}"></div>
            <h3 class="font-semibold text-lg">{testFile.name}</h3>
          </div>

          <p class="text-sm text-gray-600 mb-2">{testFile.description}</p>
          <p class="text-sm text-gray-600 mb-4">
            <strong>Expected:</strong> "{testFile.expectedMessage}"
          </p>

          <button
            class="btn {getButtonClass(index)} w-full mb-4"
            on:click={() => runTest(index)}
            disabled={testResults[index]?.testing || isRunningAllTests}
          >
            {getButtonText(index)}
          </button>

          {#if testResults[index] && !testResults[index].testing}
            <div class="test-result result-{testResults[index].success ? 'success' : 'error'}">
              {formatResult(index)}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if overallResultsVisible}
      <div class="card">
        <div class="card-header">
          <h2 class="text-2xl font-bold text-gray-900">🎯 Overall Test Results</h2>
        </div>
        <div class="card-body">
          <div class="test-result result-info">
            {getOverallSummary()}
          </div>
        </div>
      </div>
    {/if}
  </div>
</main>

<style>
  :global(.btn) {
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 14px;
  }

  :global(.btn:disabled) {
    opacity: 0.6;
    cursor: not-allowed;
  }

  :global(.btn-primary) {
    background: #3b82f6;
    color: white;
  }

  :global(.btn-primary:hover:not(:disabled)) {
    background: #2563eb;
  }

  :global(.btn-success) {
    background: #10b981;
    color: white;
  }

  :global(.btn-danger) {
    background: #ef4444;
    color: white;
  }

  :global(.btn-large) {
    padding: 16px 32px;
    font-size: 18px;
    font-weight: 700;
    border-radius: 12px;
  }

  :global(.btn-purple) {
    background: #7c3aed;
    color: white;
  }

  :global(.btn-purple:hover:not(:disabled)) {
    background: #6d28d9;
  }

  .test-card {
    background: white;
    border-radius: 12px;
    padding: 24px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    border: 2px solid transparent;
    transition: all 0.3s ease;
  }

  .test-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
  }

  .test-card.testing {
    border-color: #3b82f6;
    background: #eff6ff;
  }

  .test-card.success {
    border-color: #10b981;
    background: #ecfdf5;
  }

  .test-card.error {
    border-color: #ef4444;
    background: #fef2f2;
  }

  .status-indicator {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    margin-right: 8px;
  }

  .status-idle { background: #d1d5db; }
  .status-testing {
    background: #3b82f6;
    animation: pulse 1s infinite;
  }
  .status-success { background: #10b981; }
  .status-error { background: #ef4444; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .test-result {
    padding: 12px;
    border-radius: 6px;
    font-family: 'Monaco', monospace;
    font-size: 13px;
    white-space: pre-wrap;
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid;
  }

  .result-success {
    background: #d1fae5;
    border-color: #10b981;
    color: #065f46;
  }

  .result-error {
    background: #fee2e2;
    border-color: #ef4444;
    color: #991b1b;
  }

  .result-info {
    background: #e0f2fe;
    border-color: #0284c7;
    color: #0c4a6e;
  }

  .card {
    background: white;
    border-radius: 12px;
    padding: 24px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .card-header {
    margin-bottom: 16px;
  }

  .card-body {
    /* Additional styling if needed */
  }
</style>
