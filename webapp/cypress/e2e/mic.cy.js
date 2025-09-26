/// <reference types="cypress" />

describe('FESK recorder Test Suite', () => {

  it('should decode audio when recording with fake microphone stream', () => {
    cy.visit('/')

    cy.get('[data-test-id="toggle-record"]', { timeout: 10000 }).click()
    cy.wait(10500)
    cy.get('[data-test-id="toggle-record"]').click()

    cy.contains('Successfully decoded: "test"', { timeout: 180000 }).should('exist')
  })
})
