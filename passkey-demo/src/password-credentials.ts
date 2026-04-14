import './password-credentials.css'

type PasswordCredentialConstructor = {
  new (form: HTMLFormElement): DemoPasswordCredential
}

type DemoPasswordCredential = Credential & {
  password: string
  name?: string
  iconURL?: string
}

type PasswordCredentialWindow = Window &
  typeof globalThis & {
    PasswordCredential?: PasswordCredentialConstructor
  }

type PasswordCredentialRequestOptions = CredentialRequestOptions & {
  password?: boolean
}

type PasswordCredentialsContainer = CredentialsContainer & {
  get(options?: PasswordCredentialRequestOptions): Promise<Credential | null>
  store(credential: Credential): Promise<void>
}

const maybeForm = document.querySelector<HTMLFormElement>('#credential-form')
const maybeStoreButton =
  document.querySelector<HTMLButtonElement>('#store-button')
const maybeGetButton = document.querySelector<HTMLButtonElement>('#get-button')
const maybeLogoutButton =
  document.querySelector<HTMLButtonElement>('#logout-button')
const maybeLogOutput = document.querySelector<HTMLPreElement>('#log-output')

if (
  !maybeForm ||
  !maybeStoreButton ||
  !maybeGetButton ||
  !maybeLogoutButton ||
  !maybeLogOutput
) {
  throw new Error('Demo PasswordCredential non inizializzata')
}

const form = maybeForm
const storeButton = maybeStoreButton
const getButton = maybeGetButton
const logoutButton = maybeLogoutButton
const logOutput = maybeLogOutput
const browserWindow = window as PasswordCredentialWindow
const credentialStore = navigator.credentials as PasswordCredentialsContainer
const supportsCredentials = 'credentials' in navigator
const supportsPasswordCredential =
  supportsCredentials && typeof browserWindow.PasswordCredential === 'function'

function writeLog(message: string, details?: Record<string, string>) {
  const lines = [message]

  if (details) {
    for (const [key, value] of Object.entries(details)) {
      lines.push(`${key}: ${value}`)
    }
  }

  logOutput.textContent = lines.join('\n')
}

function disableDemo(message: string) {
  storeButton.disabled = true
  getButton.disabled = true
  logoutButton.disabled = true
  writeLog(message)
}

if (!window.isSecureContext) {
  disableDemo(
    'Questa API richiede un secure context. Usa localhost o HTTPS per provarla.',
  )
} else if (!supportsCredentials) {
  disableDemo('navigator.credentials non e\' disponibile in questo browser.')
} else if (!supportsPasswordCredential) {
  disableDemo('PasswordCredential non e\' supportata in questo browser.')
} else {
  writeLog('API disponibile. Puoi salvare o recuperare una PasswordCredential.')
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()

  if (!supportsPasswordCredential) {
    return
  }

  try {
    const credential = new browserWindow.PasswordCredential!(form)
    await credentialStore.store(credential)

    writeLog('Richiesta di salvataggio completata.', {
      type: credential.type,
      id: credential.id,
      nota: 'Il server riceverebbe ancora username e password.',
    })
  } catch (error) {
    writeLog('Salvataggio annullato o non riuscito.', {
      errore: error instanceof Error ? error.message : String(error),
    })
  }
})

getButton.addEventListener('click', async () => {
  if (!supportsPasswordCredential) {
    return
  }

  try {
    const credential = await credentialStore.get({
      password: true,
      mediation: 'optional',
    })

    if (!credential) {
      writeLog('Nessuna credenziale restituita dal browser.')
      return
    }

    if (credential.type !== 'password') {
      writeLog('Il browser ha restituito una credenziale non password.', {
        type: credential.type,
        id: credential.id,
      })
      return
    }

    const passwordCredential = credential as DemoPasswordCredential
    writeLog('PasswordCredential recuperata.', {
      type: passwordCredential.type,
      id: passwordCredential.id,
      password: passwordCredential.password,
    })
  } catch (error) {
    writeLog('Recupero annullato o non riuscito.', {
      errore: error instanceof Error ? error.message : String(error),
    })
  }
})

logoutButton.addEventListener('click', async () => {
  if (!supportsCredentials) {
    return
  }

  try {
    await navigator.credentials.preventSilentAccess()
    writeLog('Logout simulato.', {
      effetto: 'Il prossimo recupero richiedera\' una mediazione utente.',
    })
  } catch (error) {
    writeLog('Logout simulato non riuscito.', {
      errore: error instanceof Error ? error.message : String(error),
    })
  }
})
