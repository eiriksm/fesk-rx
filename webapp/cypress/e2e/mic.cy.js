/// <reference types="cypress" />

describe('FESK recorder Test Suite', () => {

  it('should decode audio when recording with fake microphone stream', () => {
    cy.visit('/')

    cy.enableAudioContext()

    cy.contains('Start Recording', { timeout: 10000 }).click()
    // Wait for like 10.5 seconds.
    cy.wait(10500)

    // Now click "stop".
    cy.get('[data-test-id="toggle-record"]').click()

    cy.contains('Successfully decoded: "test"', { timeout: 60000 }).should('exist')
  })
})
