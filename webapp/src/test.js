import './app.css'
import TestSuite from './TestSuite.svelte'

const app = new TestSuite({
  target: document.getElementById('app'),
})

export default app