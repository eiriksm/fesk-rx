<script>
  export let results = null
  export let durationMs = null

  $: decodedMessage = results?.frame?.payload ?
    new TextDecoder().decode(results.frame.payload) : null

  $: validationStatus = {
    preamble: results?.preambleValid || false,
    sync: results?.syncValid || false,
    frame: results?.frame?.isValid || false
  }

  function formatBytes(bytes) {
    if (!bytes) return ''
    return Array.from(bytes)
      .map(b => '0x' + b.toString(16).padStart(2, '0'))
      .join(' ')
  }

  function getStatusIcon(valid) {
    return valid ? '✅' : '❌'
  }

  function getStatusClass(valid) {
    return valid ? 'text-green-600' : 'text-red-600'
  }
</script>

<div class="card">
  <div class="card-header">
    <h2 class="text-lg font-semibold text-gray-900">Decoding Results</h2>
  </div>
  <div class="card-body">
    {#if !results}
      <div class="text-gray-500 text-center py-8">
        <div class="text-4xl mb-2">🔍</div>
        <p>No decoding results yet</p>
        <p class="text-sm">Start decoding to see the results</p>
      </div>
    {:else}
      <div class="space-y-6">
        <!-- Validation Status -->
        <div class="bg-gray-50 rounded-lg p-4">
          <h3 class="font-semibold text-gray-900 mb-3">Validation Status</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="flex items-center space-x-2">
              <span class="text-xl">{getStatusIcon(validationStatus.preamble)}</span>
              <span class={getStatusClass(validationStatus.preamble)}>
                Preamble
              </span>
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-xl">{getStatusIcon(validationStatus.sync)}</span>
              <span class={getStatusClass(validationStatus.sync)}>
                Sync Pattern
              </span>
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-xl">{getStatusIcon(validationStatus.frame)}</span>
              <span class={getStatusClass(validationStatus.frame)}>
                Frame CRC
              </span>
            </div>
          </div>
        </div>

        <!-- Decoded Message -->
        {#if decodedMessage}
          <div class="bg-green-50 border border-green-200 rounded-lg p-4">
            <h3 class="font-semibold text-green-800 mb-2">📄 Decoded Message</h3>
            <div class="bg-white rounded border p-3 font-mono text-lg">
              "{decodedMessage}"
            </div>
            <div class="text-sm text-green-700 mt-2">
              Length: {decodedMessage.length} characters
            </div>
          </div>
        {:else if results.frame}
          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h3 class="font-semibold text-yellow-800 mb-2">⚠️ Frame Detected</h3>
            <p class="text-yellow-700">Frame was decoded but message is not readable as text.</p>
          </div>
        {:else}
          <div class="bg-red-50 border border-red-200 rounded-lg p-4">
            <h3 class="font-semibold text-red-800 mb-2">❌ No Valid Frame</h3>
            <p class="text-red-700">Could not decode a valid FESK frame from the audio.</p>
          </div>
        {/if}

        <!-- Technical Details -->
        {#if results.frame}
          <div class="bg-gray-50 rounded-lg p-4">
            <h3 class="font-semibold text-gray-900 mb-3">Technical Details</h3>
            <div class="space-y-3 text-sm">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="font-medium text-gray-700">Payload Length:</label>
                  <span class="ml-2 font-mono">{results.frame.header?.payloadLength || 'Unknown'} bytes</span>
                </div>
                <div>
                  <label class="font-medium text-gray-700">CRC Status:</label>
                  <span class="ml-2 {getStatusClass(results.frame.isValid)}">
                    {results.frame.isValid ? 'Valid' : 'Invalid'}
                  </span>
                </div>
                {#if results.frequencySet}
                  <div>
                    <label class="font-medium text-gray-700">Frequency Set:</label>
                    <span class="ml-2 font-mono">{results.frequencySet}</span>
                  </div>
                {/if}
                {#if durationMs}
                  <div>
                    <label class="font-medium text-gray-700">Decode Time:</label>
                    <span class="ml-2 font-mono">{(durationMs / 1000).toFixed(2)}s</span>
                  </div>
                {/if}
              </div>

              {#if results.frame.crc !== undefined}
                <div>
                  <label class="font-medium text-gray-700">CRC:</label>
                  <span class="ml-2 font-mono">0x{results.frame.crc.toString(16).padStart(4, '0').toUpperCase()}</span>
                </div>
              {/if}

              {#if results.startTime !== null && results.startTime !== undefined}
                <div>
                  <label class="font-medium text-gray-700">Transmission Start:</label>
                  <span class="ml-2 font-mono">{(results.startTime / 1000).toFixed(3)}s</span>
                </div>
              {/if}

              {#if results.frame.payload}
                <div>
                  <label class="font-medium text-gray-700">Raw Payload (hex):</label>
                  <div class="mt-1 font-mono text-xs bg-white p-2 rounded border break-all">
                    {formatBytes(results.frame.payload)}
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Decoding Tips -->
        {#if !results.frame || !results.frame.isValid}
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 class="font-semibold text-blue-800 mb-2">💡 Decoding Tips</h3>
            <ul class="text-blue-700 text-sm space-y-1">
              <li>• Ensure the audio file contains a FESK transmission</li>
              <li>• Check that the audio quality is good (low noise)</li>
              <li>• Try adjusting the start time if transmission detection failed</li>
              <li>• Verify the audio uses 1200/1600/2000 Hz tone frequencies</li>
              <li>• Hardware recordings may require tolerant validation settings</li>
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
