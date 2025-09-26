// Custom Cypress commands for FESK testing

// Command to test a specific FESK file
Cypress.Commands.add('testFeskFile', (testIndex, expectedMessage) => {
  cy.log(`Testing FESK file at index ${testIndex}`)

  // Click the test button
  cy.get(`.card-index-${testIndex} button`)
    .should('be.visible')
    .and('not.be.disabled')
    .click()


  // Check if test passed
  cy.get(`.card-index-${testIndex} .test-result`, { timeout: 180000 })
    .should('have.class', 'result-success')

  // Verify the decoded message
  cy.get(`.card-index-${testIndex} .decoded-message`)
    .and('contain', expectedMessage)

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
