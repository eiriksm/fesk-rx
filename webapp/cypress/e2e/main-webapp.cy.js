/// <reference types="cypress" />

describe('FESK Decoder Main Webapp', () => {
  beforeEach(() => {
    cy.visit('/')
    cy.enableAudioContext()
  })

  it('should load the main application', () => {
    cy.get('h1').should('contain', 'FESK Audio Decoder')
    cy.get('main').should('be.visible')
    cy.contains('Frequency Shift Keying Signal Analysis').should('be.visible')
  })

  it('should load and decode sample file automatically', () => {
    // Click the Load Sample button
    cy.contains('Load Sample File').click()

    // Wait for file to load and auto-decode
    cy.contains('Decoding', { timeout: 5000 }).should('be.visible')

    // Wait for decoding to complete
    cy.contains('Successfully decoded', { timeout: 30000 }).should('be.visible')

    // Check that waveform is displayed
    cy.get('canvas').should('be.visible')

    // Check that results are shown
    cy.contains('Symbol Stream').should('be.visible')
    cy.contains('Decoding Results').should('be.visible')
  })

  it('should handle drag and drop area', () => {
    // Check drop zone is present
    cy.contains('Upload FESK Audio File').should('be.visible')

    // Check file input exists (hidden)
    cy.get('input[type="file"]').should('exist').and('not.be.visible')
  })

  it('should display microphone controls', () => {
    // Real-time listening section
    cy.contains('Start Listening').should('be.visible')

    // Recording section
    cy.contains('Start Recording').should('be.visible')

    // Both buttons should be enabled initially
    cy.contains('Start Listening').should('not.be.disabled')
    cy.contains('Start Recording').should('not.be.disabled')
  })

  it('should show proper frequency indicators in header', () => {
    // Check the frequency indicators in the header
    cy.contains('2794 Hz (F7)').should('be.visible')
    cy.contains('3520 Hz (A7)').should('be.visible')
    cy.contains('4699 Hz (D8)').should('be.visible')
  })

  it('should have responsive layout', () => {
    // Test desktop view
    cy.viewport(1280, 720)
    cy.get('.grid-cols-1').should('be.visible')

    // Test mobile view
    cy.viewport(375, 667)
    cy.get('main').should('be.visible')
    cy.contains('FESK Audio Decoder').should('be.visible')
  })

  it('should handle clear button', () => {
    // Load sample file first
    cy.contains('Load Sample File').click()
    cy.contains('Selected:', { timeout: 5000 }).should('be.visible')

    // Click clear button
    cy.contains('Clear').click()

    // Verify file is cleared
    cy.contains('Files will be decoded automatically upon upload').should('be.visible')
  })

  it('should maintain proper state during decoding', () => {
    cy.contains('Load Sample File').click()

    // Check initial status
    cy.contains('Decoding').should('be.visible')

    // Buttons should be disabled during processing
    cy.contains('Load Sample File').should('be.disabled')
    cy.contains('Clear').should('be.disabled')

    // Wait for completion
    cy.contains('Successfully decoded', { timeout: 30000 }).should('be.visible')

    // Buttons should be re-enabled
    cy.contains('Load Sample File').should('not.be.disabled')
    cy.contains('Clear').should('not.be.disabled')
  })
})
