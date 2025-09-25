// Custom Cypress commands for FESK testing

// Command to test a specific FESK file
Cypress.Commands.add('testFeskFile', (testIndex, expectedMessage, expectedStartTime = null, tolerance = 500) => {
  cy.log(`Testing FESK file at index ${testIndex}`)

  // Click the test button
  cy.get(`#button-${testIndex}`)
    .should('be.visible')
    .and('not.be.disabled')
    .click()

  // Wait for test to complete
  cy.get(`#button-${testIndex}`, { timeout: 30000 })
    .should('not.contain', 'Testing...')

  // Check if test passed
  cy.get(`#card-${testIndex}`)
    .should('have.class', 'success')

  // Verify the decoded message
  cy.get(`#result-${testIndex}`)
    .should('be.visible')
    .and('contain', expectedMessage)

  // If expected start time is provided, verify timing
  if (expectedStartTime !== null) {
    cy.get(`#result-${testIndex}`)
      .should('contain', 'START TIME:')
  }

  cy.log(`✅ FESK file test ${testIndex} passed`)
})

// Command to run all tests and verify results
Cypress.Commands.add('runAllFeskTests', (expectedResults) => {
  // Click run all tests button
  cy.get('#runAllTests')
    .should('be.visible')
    .click()

  // Wait for all tests to complete
  cy.get('#runAllTests', { timeout: 60000 })
    .should('not.be.disabled')
    .and('contain', 'Run All Tests')

  // Check overall results
  cy.get('#overallResults')
    .should('be.visible')

  // Verify each expected result
  expectedResults.forEach((expected, index) => {
    if (expected.shouldPass) {
      cy.get(`#card-${index}`)
        .should('have.class', 'success')
      cy.get(`#result-${index}`)
        .should('contain', expected.message)
    }
  })

  // Check summary
  cy.get('#testSummary')
    .should('be.visible')
    .and('contain', 'TOTAL TESTS:')
})

// Command to check audio context readiness
Cypress.Commands.add('enableAudioContext', () => {
  cy.window().then((win) => {
    // Interact with page to enable audio context
    cy.get('body').click()

    // Wait a moment for audio context to be ready
    cy.wait(100)
  })
})