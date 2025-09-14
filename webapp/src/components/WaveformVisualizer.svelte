<script>
  import { onMount, afterUpdate } from 'svelte'

  export let audioData = null
  export let symbols = []
  export let isDecoding = false

  let canvas
  let ctx
  let animationId

  const COLORS = {
    waveform: '#3b82f6',
    background: '#1f2937',
    grid: '#374151',
    symbol0: '#1e40af', // 1200 Hz - Blue
    symbol1: '#0891b2', // 1600 Hz - Cyan
    symbol2: '#059669'  // 2000 Hz - Emerald
  }

  onMount(() => {
    if (canvas) {
      ctx = canvas.getContext('2d')
      drawVisualization()
    }
  })

  afterUpdate(() => {
    if (canvas && ctx) {
      drawVisualization()
    }
  })

  function drawVisualization() {
    if (!ctx || !canvas) return

    const { width, height } = canvas
    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, width, height)

    if (!audioData) {
      // Draw placeholder
      ctx.fillStyle = '#6b7280'
      ctx.font = '16px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('No audio data loaded', width / 2, height / 2)
      return
    }

    drawWaveform()
    drawSymbolMarkers()

    if (isDecoding) {
      drawDecodingAnimation()
    }
  }

  function drawWaveform() {
    const { data } = audioData
    const { width, height } = canvas

    // Draw grid
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    ctx.setLineDash([2, 2])

    // Horizontal grid lines
    for (let i = 0; i <= 4; i++) {
      const y = (height / 4) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    // Vertical grid lines
    for (let i = 0; i <= 10; i++) {
      const x = (width / 10) * i
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }

    ctx.setLineDash([])

    // Draw waveform
    ctx.strokeStyle = COLORS.waveform
    ctx.lineWidth = 1.5
    ctx.beginPath()

    const samplesPerPixel = Math.max(1, Math.floor(data.length / width))
    const centerY = height / 2
    const amplitude = height * 0.4

    for (let x = 0; x < width; x++) {
      const sampleIndex = Math.floor((x / width) * data.length)

      if (sampleIndex < data.length) {
        // RMS calculation for better visualization of dense data
        let rms = 0
        const endIndex = Math.min(sampleIndex + samplesPerPixel, data.length)

        for (let i = sampleIndex; i < endIndex; i++) {
          rms += data[i] * data[i]
        }
        rms = Math.sqrt(rms / (endIndex - sampleIndex))

        const y = centerY + (rms * amplitude * (data[sampleIndex] < 0 ? -1 : 1))

        if (x === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      }
    }

    ctx.stroke()
  }

  function drawSymbolMarkers() {
    if (!symbols || symbols.length === 0) return

    const { width, height } = canvas
    const symbolWidth = width / symbols.length

    symbols.forEach((symbol, index) => {
      const x = index * symbolWidth
      const color = COLORS[`symbol${symbol}`] || '#6b7280'

      // Draw symbol indicator bar
      ctx.fillStyle = color + '40' // Add transparency
      ctx.fillRect(x, 0, symbolWidth, height)

      // Draw symbol boundary
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.setLineDash([1, 1])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
      ctx.setLineDash([])

      // Draw symbol number
      if (symbolWidth > 20) {
        ctx.fillStyle = color
        ctx.font = '12px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(symbol.toString(), x + symbolWidth / 2, height - 10)
      }
    })
  }

  function drawDecodingAnimation() {
    const { width, height } = canvas
    const time = Date.now() / 1000

    // Animated scanning line
    const scanX = ((time * 50) % width)

    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(scanX, 0)
    ctx.lineTo(scanX, height)
    ctx.stroke()
    ctx.setLineDash([])

    if (isDecoding) {
      animationId = requestAnimationFrame(() => drawVisualization())
    }
  }

  function handleResize() {
    if (canvas && canvas.parentElement) {
      canvas.width = canvas.parentElement.clientWidth
      canvas.height = 300
      drawVisualization()
    }
  }

  onMount(() => {
    handleResize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (animationId) {
        cancelAnimationFrame(animationId)
      }
    }
  })
</script>

<div class="card">
  <div class="card-header">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-gray-900">Audio Waveform</h2>
      {#if audioData}
        <div class="text-sm text-gray-600 font-mono">
          {audioData.sampleRate} Hz • {audioData.duration?.toFixed(2)}s
        </div>
      {/if}
    </div>
  </div>
  <div class="card-body p-0">
    <div class="waveform-container relative">
      <canvas
        bind:this={canvas}
        class="w-full h-[300px] block"
        width="800"
        height="300"
      ></canvas>

      {#if isDecoding}
        <div class="absolute top-2 right-2 bg-yellow-500 text-white px-2 py-1 rounded text-sm font-medium animate-pulse">
          Analyzing...
        </div>
      {/if}
    </div>
  </div>
</div>