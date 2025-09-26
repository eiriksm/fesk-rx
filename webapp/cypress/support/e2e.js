// Cypress support file for FESK decoder testing

// Import commands
import './commands'

// Global test configuration
Cypress.on('uncaught:exception', (err, runnable) => {
  // Don't fail tests on uncaught exceptions (useful for audio context issues)
  if (err.message.includes('AudioContext')) {
    return false
  }
  if (err.message.includes('suspend')) {
    return false
  }
  return true
})

// Custom command to wait for FESK decoding to complete
Cypress.Commands.add('waitForFeskDecode', (timeout = 20000) => {
  cy.get('[data-cy="decoding-status"]', { timeout })
    .should('not.contain', 'processing')
    .should('not.contain', 'Decoding')
})

// Custom command to check decoded message
Cypress.Commands.add('checkDecodedMessage', (expectedMessage) => {
  cy.get('[data-cy="decoded-message"]')
    .should('be.visible')
    .and('contain', expectedMessage)
})

// Custom command to upload FESK file
Cypress.Commands.add('uploadFeskFile', (filename) => {
  cy.fixture(filename, 'binary').then((fileContent) => {
    const blob = Cypress.Blob.binaryStringToBlob(fileContent, 'audio/wav')
    const file = new File([blob], filename, { type: 'audio/wav' })

    cy.get('input[type="file"]').then(($input) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      $input[0].files = dataTransfer.files
      $input[0].dispatchEvent(new Event('change', { bubbles: true }))
    })
  })
})