<script>
  export let symbols = []

  $: symbolGroups = groupSymbols(symbols)

  function groupSymbols(symbols) {
    const groups = []
    for (let i = 0; i < symbols.length; i += 16) {
      groups.push({
        offset: i,
        symbols: symbols.slice(i, i + 16)
      })
    }
    return groups
  }

  function getSymbolClass(symbol) {
    const baseClass = 'inline-flex items-center justify-center w-8 h-8 rounded text-sm font-mono font-semibold'
    const colorClass = {
      0: 'bg-fesk-blue text-white',
      1: 'bg-fesk-cyan text-white',
      2: 'bg-fesk-emerald text-white'
    }[symbol] || 'bg-gray-300 text-gray-700'

    return `${baseClass} ${colorClass}`
  }

  function getFrequencyLabel(symbol) {
    return {
      0: '2794Hz (F7)',
      1: '3520Hz (A7)',
      2: '4699Hz (D8)'
    }[symbol] || 'Unknown'
  }
</script>

<div class="card">
  <div class="card-header">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-gray-900">Symbol Stream</h2>
      <div class="text-sm text-gray-600">
        {symbols.length} symbols detected
      </div>
    </div>
  </div>
  <div class="card-body">
    {#if symbols.length === 0}
      <div class="text-gray-500 text-center py-8">
        <div class="text-4xl mb-2">📡</div>
        <p>No symbols detected yet</p>
        <p class="text-sm">Upload and decode an audio file to see the symbol stream</p>
      </div>
    {:else}
      <div class="space-y-4">
        <!-- Legend -->
        <div class="flex items-center justify-center space-x-6 py-2 bg-gray-50 rounded-lg">
          <div class="flex items-center space-x-2">
            <div class="w-4 h-4 bg-fesk-blue rounded"></div>
            <span class="text-sm">0 (2794Hz/F7)</span>
          </div>
          <div class="flex items-center space-x-2">
            <div class="w-4 h-4 bg-fesk-cyan rounded"></div>
            <span class="text-sm">1 (3520Hz/A7)</span>
          </div>
          <div class="flex items-center space-x-2">
            <div class="w-4 h-4 bg-fesk-emerald rounded"></div>
            <span class="text-sm">2 (4699Hz/D8)</span>
          </div>
        </div>

        <!-- Symbol Groups -->
        <div class="space-y-3">
          {#each symbolGroups as group (group.offset)}
            <div class="flex items-center space-x-3">
              <!-- Offset -->
              <div class="text-sm text-gray-500 font-mono w-12 text-right">
                {group.offset.toString().padStart(3, '0')}:
              </div>

              <!-- Symbols -->
              <div class="flex space-x-1 flex-1">
                {#each group.symbols as symbol, index (group.offset + index)}
                  <div
                    class={getSymbolClass(symbol)}
                    title="Symbol {symbol} ({getFrequencyLabel(symbol)}) at position {group.offset + index}"
                  >
                    {symbol}
                  </div>
                {/each}

                <!-- Fill empty spaces in incomplete groups -->
                {#if group.symbols.length < 16}
                  {#each Array(16 - group.symbols.length) as _, index}
                    <div class="w-8 h-8 border border-dashed border-gray-200 rounded"></div>
                  {/each}
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- Summary Statistics -->
        <div class="mt-6 pt-4 border-t border-gray-200">
          <div class="grid grid-cols-3 gap-4 text-center">
            <div class="bg-fesk-blue bg-opacity-10 rounded-lg p-3">
              <div class="text-2xl font-bold text-fesk-blue">
                {symbols.filter(s => s === 0).length}
              </div>
              <div class="text-sm text-gray-600">Symbol 0</div>
            </div>
            <div class="bg-fesk-cyan bg-opacity-10 rounded-lg p-3">
              <div class="text-2xl font-bold text-fesk-cyan">
                {symbols.filter(s => s === 1).length}
              </div>
              <div class="text-sm text-gray-600">Symbol 1</div>
            </div>
            <div class="bg-fesk-emerald bg-opacity-10 rounded-lg p-3">
              <div class="text-2xl font-bold text-fesk-emerald">
                {symbols.filter(s => s === 2).length}
              </div>
              <div class="text-sm text-gray-600">Symbol 2</div>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>