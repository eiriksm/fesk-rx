import { defineConfig } from 'cypress'
import path from 'path'

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    supportFile: 'cypress/support/e2e.js',
    specPattern: 'cypress/e2e/**/*.cy.js',
    setupNodeEvents(on, config) {
      on('before:browser:launch', (browser = {}, launchOptions) => {
        if (browser.family === 'chromium') {
          launchOptions.args.push('--use-fake-ui-for-media-stream')
          launchOptions.args.push('--use-fake-device-for-media-stream')

          const audioFixture = config.env.fakeAudioCapture || 'public/webapp-fesk2.wav'
          const resolvedPath = path.resolve(config.projectRoot, audioFixture)
          launchOptions.args.push(`--use-file-for-fake-audio-capture=${resolvedPath}`)
        }

        return launchOptions
      })

      return config
    },
    defaultCommandTimeout: 30000, // Longer timeout for FESK decoding
    pageLoadTimeout: 30000,
    requestTimeout: 30000,
    responseTimeout: 30000,
    video: false, // Disable video recording for faster tests
    screenshot: true,
    screenshotOnRunFailure: true,
    viewportWidth: 1280,
    viewportHeight: 720,
  }
})
