import './passkey-demo.css'
import { PasskeyDemoServer } from './passkey-server'

const accountForm = query<HTMLFormElement>('#account-form')
const usernameInput = query<HTMLInputElement>('#username')
const registerButton = query<HTMLButtonElement>('#register-button')
const loginButton = query<HTMLButtonElement>('#login-button')
const logoutButton = query<HTMLButtonElement>('#logout-button')
const clearLogButton = query<HTMLButtonElement>('#clear-log-button')
const sessionState = query<HTMLElement>('#session-state')
const credentialState = query<HTMLElement>('#credential-state')
const challengeState = query<HTMLElement>('#challenge-state')
const serverMemory = query<HTMLPreElement>('#server-memory')
const serverLog = query<HTMLPreElement>('#server-log')

const server = new PasskeyDemoServer(location)

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Elemento mancante: ${selector}`)
  }

  return element
}

function render() {
  const username = usernameInput.value.trim()
  const sessionUser = server.getSessionUser()
  const credentialId = server.getCredentialId(username)

  sessionState.textContent = sessionUser
    ? `Autenticato come ${sessionUser}`
    : 'Non autenticato'
  credentialState.textContent = credentialId ?? 'Nessuna passkey registrata'
  challengeState.textContent = String(server.getChallengeCount())
  registerButton.disabled = false
  loginButton.disabled = !server.hasCredential(username) || Boolean(sessionUser)
  logoutButton.disabled = !sessionUser
  serverMemory.textContent = JSON.stringify(server.snapshot(), null, 2)
  serverLog.textContent = server.getLogs().join('\n\n') || 'Nessun evento.'
}

function getUsername() {
  const username = usernameInput.value.trim()

  if (!username) {
    throw new Error('Inserisci un account')
  }

  return username
}

function ensurePasskeySupport() {
  if (!window.isSecureContext) {
    throw new Error('WebAuthn richiede HTTPS o localhost')
  }

  if (!('PublicKeyCredential' in window)) {
    throw new Error('Questo browser non supporta WebAuthn')
  }
}

async function createPasskey(username: string) {
  const publicKey = server.createRegistrationOptions(username)
  const credential = await navigator.credentials.create({ publicKey })
  console.log({credential})

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('Il browser non ha restituito una PublicKeyCredential')
  }

  server.finishRegistration(username, credential)
}

async function getPasskey(username: string) {
  const publicKey = server.createLoginOptions(username)
  const credential = await navigator.credentials.get({ publicKey })

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('Il browser non ha restituito una PublicKeyCredential')
  }

  await server.finishLogin(username, credential)
}

async function runAction(action: () => Promise<void> | void) {
  registerButton.disabled = true
  loginButton.disabled = true
  logoutButton.disabled = true

  try {
    ensurePasskeySupport()
    await action()
  } catch (error) {
    server.logError(error)
  } finally {
    render()
  }
}

accountForm.addEventListener('submit', (event) => {
  event.preventDefault()
})

registerButton.addEventListener('click', () => {
  void runAction(async () => createPasskey(getUsername()))
})

loginButton.addEventListener('click', () => {
  void runAction(async () => getPasskey(getUsername()))
})

logoutButton.addEventListener('click', () => {
  void runAction(() => server.logout())
})

clearLogButton.addEventListener('click', () => {
  server.clearLogs()
  render()
})

usernameInput.addEventListener('input', render)

render()
