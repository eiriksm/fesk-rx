/// <reference types="cypress" />

describe('FESK Decoder Test Suite', () => {
  const testFiles = [
    {
      name: 'fesk1.wav',
      expectedMessage: 'test',
    },
    {
      name: 'fesk2.wav',
      expectedMessage: 'three45',
    },
    {
      name: 'fesk3.wav',
      expectedMessage: 'a fairly long and might i say convoluted test message?',
    },
    {
      name: 'fesk1mp.wav',
      expectedMessage: 'test',
    },
    {
      name: 'webapp-fesk1.wav',
      expectedMessage: 'test',
    },
    {
      name: 'webapp-fesk2.wav',
      expectedMessage: 'test',
    },
  ]

  beforeEach(() => {
    // Visit the test page
    cy.visit('/test.html')
    cy.get('.test-card').should('have.length', testFiles.length)
  })

  it('should load the test page with all test cards', () => {
    cy.get('h1').should('contain', 'FESK Decoder Test Suite')

    // Check each test card is present
    testFiles.forEach((testFile, index) => {
      cy.get(`.card-index-${index}`)
        .should('be.visible')
        .and('contain', testFile.name)
        .and('contain', testFile.expectedMessage)
    })
  })

  it('should successfully decode fesk1.wav', () => {
    const testFile = testFiles[0] // fesk1.wav
    cy.testFeskFile(
      0,
      testFile.expectedMessage
    )
  })

  it('should successfully decode fesk2.wav', () => {
    const testFile = testFiles[1] // fesk2.wav
    cy.testFeskFile(
      1,
      testFile.expectedMessage
    )
  })

  it('should successfully decode fesk3.wav', () => {
    const testFile = testFiles[2] // fesk3.wav
    cy.testFeskFile(
      2,
      testFile.expectedMessage,
    )
  })

  it('should successfully decode fesk1mp.wav', () => {
    const testFile = testFiles[3] // fesk1mp.wav
    cy.testFeskFile(
      3,
      testFile.expectedMessage,
    )
  })

  it('should successfully decode webapp-fesk1.wav', () => {
    const testFile = testFiles[4] // webapp-fesk1.wav
    cy.testFeskFile(
      4,
      testFile.expectedMessage,
    )
  })

  it('should successfully decode webapp-fesk2.wav', () => {
    const testFile = testFiles[5] // webapp-fesk2.wav
    cy.testFeskFile(
      5,
      testFile.expectedMessage,
    )
  })


})
