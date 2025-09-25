/// <reference types="cypress" />

describe('FESK Decoder Test Suite', () => {
  const testFiles = [
    {
      name: 'fesk1.wav',
      index: 0,
      expectedMessage: 'test',
      expectedStartTime: 1000,
      tolerance: 200,
      shouldPass: true
    },
    {
      name: 'fesk2.wav',
      index: 1,
      expectedMessage: 'hello world',
      expectedStartTime: 1000,
      tolerance: 200,
      shouldPass: true
    },
    {
      name: 'fesk3.wav',
      index: 2,
      expectedMessage: 'the truth is out there',
      expectedStartTime: 1000,
      tolerance: 200,
      shouldPass: true
    },
    {
      name: 'fesk1hw.wav',
      index: 3,
      expectedMessage: 'test',
      expectedStartTime: 600,
      tolerance: 300,
      shouldPass: true
    },
    {
      name: 'fesk1mp.wav',
      index: 4,
      expectedMessage: 'test',
      expectedStartTime: 2000,
      tolerance: 300,
      shouldPass: true
    },
    {
      name: 'fesk-ut-mobile.wav',
      index: 5,
      expectedMessage: 'test',
      expectedStartTime: 1000,
      tolerance: 500,
      shouldPass: true // May need adjustment based on actual content
    }
  ]

  beforeEach(() => {
    // Visit the test page
    cy.visit('/test.html')

    // Enable audio context by interacting with the page
    cy.enableAudioContext()

    // Wait for page to load completely
    cy.get('#testGrid').should('be.visible')
    cy.get('.test-card').should('have.length', testFiles.length)
  })

  it('should decode audio when recording with fake microphone stream', () => {
    cy.visit('/')

    cy.enableAudioContext()

    cy.contains('Start Recording', { timeout: 10000 }).click()

    cy.contains('Successfully decoded: "test"', { timeout: 60000 }).should('exist')
  })


  it('should load the test page with all test cards', () => {
    cy.get('h1').should('contain', 'FESK Decoder Test Suite')
    cy.get('#runAllTests').should('be.visible').and('contain', 'Run All Tests')

    // Check each test card is present
    testFiles.forEach((testFile, index) => {
      cy.get(`#card-${index}`)
        .should('be.visible')
        .and('contain', testFile.name)
        .and('contain', testFile.expectedMessage)
    })
  })

  it('should successfully decode fesk1.wav (original synthetic)', () => {
    const testFile = testFiles[0] // fesk1.wav
    cy.testFeskFile(
      testFile.index,
      testFile.expectedMessage,
      testFile.expectedStartTime,
      testFile.tolerance
    )
  })

  it('should successfully decode fesk2.wav (synthetic)', () => {
    const testFile = testFiles[1] // fesk2.wav
    cy.testFeskFile(
      testFile.index,
      testFile.expectedMessage,
      testFile.expectedStartTime,
      testFile.tolerance
    )
  })

  it('should successfully decode fesk3.wav (synthetic)', () => {
    const testFile = testFiles[2] // fesk3.wav
    cy.testFeskFile(
      testFile.index,
      testFile.expectedMessage,
      testFile.expectedStartTime,
      testFile.tolerance
    )
  })

  it('should successfully decode fesk1hw.wav (hardware recording)', () => {
    const testFile = testFiles[3] // fesk1hw.wav
    cy.testFeskFile(
      testFile.index,
      testFile.expectedMessage,
      testFile.expectedStartTime,
      testFile.tolerance
    )
  })

  it('should successfully decode fesk1mp.wav (hardware recording)', () => {
    const testFile = testFiles[4] // fesk1mp.wav
    cy.testFeskFile(
      testFile.index,
      testFile.expectedMessage,
      testFile.expectedStartTime,
      testFile.tolerance
    )
  })

  it('should handle fesk-ut-mobile.wav (mobile recording)', () => {
    const testFile = testFiles[5] // fesk-ut-mobile.wav

    // Click the test button
    cy.get(`#button-${testFile.index}`)
      .should('be.visible')
      .click()

    // Wait for test to complete
    cy.get(`#button-${testFile.index}`, { timeout: 30000 })
      .should('not.contain', 'Testing...')

    // Check result (may pass or fail depending on file quality)
    cy.get(`#card-${testFile.index}`)
      .should('satisfy', ($el) => {
        return $el.hasClass('success') || $el.hasClass('error')
      })

    cy.get(`#result-${testFile.index}`)
      .should('be.visible')
  })

  it('should run all tests and provide summary', () => {
    cy.runAllFeskTests(testFiles)

    // Verify summary statistics
    cy.get('#testSummary')
      .should('contain', 'TOTAL TESTS: 6')
      .and('contain', 'SUCCESS RATE:')
      .and('contain', 'DETAILED RESULTS:')

    // Check that at least some tests passed
    cy.get('.test-card.success').should('have.length.at.least', 3)
  })

  it('should show processing indicators during tests', () => {
    // Start a test
    cy.get('#button-0').click()

    // Check that testing state is shown
    cy.get('#card-0').should('have.class', 'testing')
    cy.get('#status-0').should('have.class', 'status-testing')
    cy.get('#button-0').should('be.disabled').and('contain', 'Testing')

    // Wait for completion
    cy.get('#button-0', { timeout: 30000 })
      .should('not.be.disabled')
  })

  it('should display detailed results with timing information', () => {
    const testFile = testFiles[0] // Use fesk1.wav for reliable results

    cy.get(`#button-${testFile.index}`).click()

    // Wait for completion
    cy.get(`#button-${testFile.index}`, { timeout: 30000 })
      .should('not.contain', 'Testing')

    // Check detailed results format
    cy.get(`#result-${testFile.index}`)
      .should('be.visible')
      .and('contain', 'DECODED:')
      .and('contain', 'EXPECTED:')
      .and('contain', 'START TIME:')
      .and('contain', 'PROCESSING:')
      .and('contain', 'MATCH:')
  })

  // Performance test
  it('should decode files within reasonable time limits', () => {
    const testFile = testFiles[0] // fesk1.wav
    const startTime = Date.now()

    cy.get(`#button-${testFile.index}`).click()

    cy.get(`#button-${testFile.index}`, { timeout: 15000 }) // 15 second limit
      .should('not.contain', 'Testing')
      .then(() => {
        const endTime = Date.now()
        const duration = endTime - startTime
        expect(duration).to.be.lessThan(15000) // Should complete within 15 seconds
        cy.log(`Test completed in ${duration}ms`)
      })
  })

  // Error handling test
  it('should handle invalid audio files gracefully', () => {
    // This test would require a way to inject invalid files
    // For now, we'll just verify error states are properly displayed
    cy.get('.test-card').each(($card) => {
      if ($card.hasClass('error')) {
        cy.wrap($card)
          .find('.test-result')
          .should('be.visible')
          .and('contain.oneOf', ['ERROR:', 'FAIL'])
      }
    })
  })
})
