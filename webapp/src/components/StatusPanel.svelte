<script>
  export let status = 'idle' // idle, processing, completed, error
  export let message = ''
  export let progress = 0

  $: statusIcon = {
    idle: '⚪',
    processing: '🔄',
    completed: '✅',
    error: '❌'
  }[status]

  $: statusColor = {
    idle: 'text-gray-500',
    processing: 'text-blue-500',
    completed: 'text-green-500',
    error: 'text-red-500'
  }[status]

  $: progressBarColor = {
    idle: 'bg-gray-300',
    processing: 'bg-blue-500',
    completed: 'bg-green-500',
    error: 'bg-red-500'
  }[status]
</script>

<div class="card">
  <div class="card-body">
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <span class="text-2xl animate-pulse">{statusIcon}</span>
        <div>
          <h3 class="font-semibold {statusColor}">
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </h3>
          <p class="text-sm text-gray-600">{message}</p>
        </div>
      </div>

      {#if status === 'processing'}
        <div class="text-right">
          <div class="text-sm text-gray-600 mb-1">{Math.round(progress)}%</div>
          <div class="w-32 bg-gray-200 rounded-full h-2">
            <div
              class="h-2 rounded-full transition-all duration-300 {progressBarColor}"
              style="width: {progress}%"
            ></div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>