type StoredUser = {
  id: Uint8Array
  username: string
  displayName: string
  credentialId: string
  publicKey: ArrayBuffer
  algorithm: number
  signCount: number
}

type PendingChallenge = {
  type: 'registration' | 'login'
  challenge: Uint8Array
  username: string
  userId: Uint8Array
  createdAt: Date
}

type AttestationResponseWithPublicKey = AuthenticatorAttestationResponse & {
  getPublicKey?: () => ArrayBuffer | null
  getPublicKeyAlgorithm?: () => number
}

export type ServerSnapshot = {
  rpId: string
  origin: string
  session: string | null
  challenges: Array<{
    type: PendingChallenge['type']
    username: string
    challenge: string
    createdAt: string
  }>
  users: Array<{
    username: string
    credentialId: string
    publicKeyBytes: number
    algorithm: string
    signCount: number
  }>
}

const decoder = new TextDecoder()

export class PasskeyDemoServer {
  readonly rpId: string | undefined
  readonly origin: string

  private readonly challenges = new Map<string, PendingChallenge>()
  private readonly users = new Map<string, StoredUser>()
  private sessionUser: string | null = null
  private logLines: string[] = []

  constructor(location: Location) {
    this.rpId = isIpAddress(location.hostname) ? undefined : location.hostname
    this.origin = location.origin
    this.addLog('Server simulato avviato', {
      rpId: this.rpId ?? 'default browser RP ID',
      origin: this.origin,
    })
  }

  getSessionUser() {
    return this.sessionUser
  }

  hasCredential(username: string) {
    return this.users.has(username)
  }

  getCredentialId(username: string) {
    const user = this.users.get(username)
    return user ? shortId(user.credentialId) : null
  }

  getChallengeCount() {
    return this.challenges.size
  }

  getLogs() {
    return this.logLines
  }

  clearLogs() {
    this.logLines = []
  }

  createRegistrationOptions(username: string): PublicKeyCredentialCreationOptions {
    const existing = this.users.get(username)
    const userId = existing?.id ?? randomBytes(16)
    const challenge = this.createChallenge('registration', username, userId)

    return {
      challenge: toArrayBuffer(challenge),
      rp: {
        name: 'Passkey presentation demo',
        ...(this.rpId ? { id: this.rpId } : {}),
      },
      user: {
        id: toArrayBuffer(userId),
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      attestation: 'none',
      timeout: 60000,
    }
  }

  finishRegistration(username: string, credential: PublicKeyCredential) {
    const response = credential.response as AttestationResponseWithPublicKey
    const publicKey = response.getPublicKey?.()
    const algorithm = response.getPublicKeyAlgorithm?.()

    if (!publicKey || algorithm === undefined) {
      throw new Error('Il browser non espone la public key della credenziale')
    }

    const pending = this.assertClientData(response, 'webauthn.create', username)

    this.users.set(username, {
      id: pending.userId,
      username,
      displayName: username,
      credentialId: bufferToBase64Url(credential.rawId),
      publicKey,
      algorithm,
      signCount: 0,
    })
    this.sessionUser = username
    this.addLog('Public key salvata in memoria', {
      username,
      credentialId: shortId(bufferToBase64Url(credential.rawId)),
      algorithm: algorithmLabel(algorithm),
      publicKeyBytes: publicKey.byteLength,
    })
  }

  createLoginOptions(username: string): PublicKeyCredentialRequestOptions {
    const storedUser = this.users.get(username)

    if (!storedUser) {
      throw new Error('Nessuna passkey registrata per questo account')
    }

    const challenge = this.createChallenge('login', username, storedUser.id)

    return {
      challenge: toArrayBuffer(challenge),
      ...(this.rpId ? { rpId: this.rpId } : {}),
      allowCredentials: [
        {
          id: toArrayBuffer(base64UrlToBytes(storedUser.credentialId)),
          type: 'public-key',
        },
      ],
      userVerification: 'preferred',
      timeout: 60000,
    }
  }

  async finishLogin(username: string, credential: PublicKeyCredential) {
    const storedUser = this.users.get(username)

    if (!storedUser) {
      throw new Error('Nessuna passkey registrata per questo account')
    }

    if (bufferToBase64Url(credential.rawId) !== storedUser.credentialId) {
      throw new Error('Credential ID diverso da quello salvato')
    }

    const response = credential.response as AuthenticatorAssertionResponse
    this.assertClientData(response, 'webauthn.get', username)

    const authData = parseAuthenticatorData(response.authenticatorData)
    const isSignatureValid = await verifyAssertionSignature(storedUser, response)

    if (!isSignatureValid) {
      throw new Error('Firma non valida')
    }

    storedUser.signCount = Math.max(storedUser.signCount, authData.signCount)
    this.sessionUser = username
    this.addLog('Login verificato', {
      username,
      signature: 'valida',
      userPresent: String(authData.userPresent),
      userVerified: String(authData.userVerified),
      signCount: authData.signCount,
    })
  }

  logout() {
    const username = this.sessionUser
    this.sessionUser = null
    this.addLog('Sessione chiusa', {
      username: username ?? 'nessuna sessione',
    })
  }

  logError(error: unknown) {
    this.addLog('Errore', {
      message: error instanceof Error ? error.message : String(error),
    })
  }

  snapshot(): ServerSnapshot {
    return {
      rpId: this.rpId ?? 'default browser RP ID',
      origin: this.origin,
      session: this.sessionUser,
      challenges: Array.from(this.challenges.values()).map((challenge) => ({
        type: challenge.type,
        username: challenge.username,
        challenge: shortId(bytesToBase64Url(challenge.challenge)),
        createdAt: challenge.createdAt.toLocaleTimeString('it-IT'),
      })),
      users: Array.from(this.users.values()).map((stored) => ({
        username: stored.username,
        credentialId: shortId(stored.credentialId),
        publicKeyBytes: stored.publicKey.byteLength,
        algorithm: algorithmLabel(stored.algorithm),
        signCount: stored.signCount,
      })),
    }
  }

  private createChallenge(
    type: PendingChallenge['type'],
    username: string,
    userId: Uint8Array,
  ) {
    const challenge = randomBytes(32)
    const key = bytesToBase64Url(challenge)

    this.challenges.set(key, {
      type,
      challenge,
      username,
      userId,
      createdAt: new Date(),
    })
    this.addLog('Challenge generata', {
      type,
      username,
      challenge: shortId(key),
    })

    return challenge
  }

  private consumeChallenge(
    type: PendingChallenge['type'],
    username: string,
    challenge: string,
  ) {
    const pending = this.challenges.get(challenge)

    if (!pending) {
      throw new Error('Challenge assente o gia usata')
    }

    if (pending.type !== type || pending.username !== username) {
      throw new Error('Challenge associata al flusso sbagliato')
    }

    this.challenges.delete(challenge)
    return pending
  }

  private assertClientData(
    response: AuthenticatorResponse,
    expectedType: string,
    username: string,
  ) {
    const clientData = getClientData(response)

    if (clientData.type !== expectedType) {
      throw new Error(`Tipo clientData inatteso: ${clientData.type}`)
    }

    if (clientData.origin !== this.origin) {
      throw new Error(`Origin inattesa: ${clientData.origin}`)
    }

    const pending = this.consumeChallenge(
      expectedType === 'webauthn.create' ? 'registration' : 'login',
      username,
      clientData.challenge,
    )

    this.addLog('Client data verificato', {
      type: clientData.type,
      origin: clientData.origin,
      challenge: shortId(clientData.challenge),
    })

    return pending
  }

  private addLog(message: string, details: Record<string, string | number> = {}) {
    const time = new Intl.DateTimeFormat('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date())
    const detailText = Object.entries(details)
      .map(([key, value]) => `\n    ${key}: ${value}`)
      .join('')

    this.logLines.unshift(`[${time}] ${message}${detailText}`)
    this.logLines = this.logLines.slice(0, 80)
  }
}

function getClientData(response: AuthenticatorResponse) {
  const json = decoder.decode(response.clientDataJSON)
  return JSON.parse(json) as {
    type: string
    challenge: string
    origin: string
  }
}

function parseAuthenticatorData(authenticatorData: ArrayBuffer) {
  const bytes = new Uint8Array(authenticatorData)
  const flags = bytes[32] ?? 0
  const dataView = new DataView(authenticatorData)

  return {
    userPresent: Boolean(flags & 0x01),
    userVerified: Boolean(flags & 0x04),
    signCount: dataView.getUint32(33, false),
  }
}

async function importPublicKey(publicKey: ArrayBuffer, algorithm: number) {
  if (algorithm === -7) {
    return crypto.subtle.importKey(
      'spki',
      publicKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
  }

  if (algorithm === -257) {
    return crypto.subtle.importKey(
      'spki',
      publicKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
  }

  throw new Error(`Algoritmo non gestito nella demo: ${algorithm}`)
}

function normalizeSignature(signature: ArrayBuffer, algorithm: number) {
  if (algorithm !== -7) {
    return signature
  }

  return derToRawEcdsaSignature(new Uint8Array(signature), 32)
}

function derToRawEcdsaSignature(signature: Uint8Array, partLength: number) {
  let offset = 0

  if (signature[offset++] !== 0x30) {
    throw new Error('Firma ECDSA non DER: sequence mancante')
  }

  const sequenceLength = readDerLength(signature, offset)
  offset = sequenceLength.offset

  const r = readDerInteger(signature, offset)
  offset = r.offset
  const s = readDerInteger(signature, offset)

  return concatBytes(padInteger(r.value, partLength), padInteger(s.value, partLength))
}

function readDerLength(bytes: Uint8Array, offset: number) {
  const first = bytes[offset++]

  if (first === undefined) {
    throw new Error('Lunghezza DER mancante')
  }

  if (first < 0x80) {
    return { length: first, offset }
  }

  const lengthBytes = first & 0x7f
  let length = 0

  for (let index = 0; index < lengthBytes; index += 1) {
    length = (length << 8) | bytes[offset++]
  }

  return { length, offset }
}

function readDerInteger(bytes: Uint8Array, offset: number) {
  if (bytes[offset++] !== 0x02) {
    throw new Error('Firma ECDSA non DER: integer mancante')
  }

  const integerLength = readDerLength(bytes, offset)
  offset = integerLength.offset
  const value = bytes.slice(offset, offset + integerLength.length)

  return {
    value,
    offset: offset + integerLength.length,
  }
}

function padInteger(value: Uint8Array, length: number) {
  const trimmed = value[0] === 0 ? value.slice(1) : value

  if (trimmed.length > length) {
    throw new Error('Intero ECDSA piu lungo del previsto')
  }

  const output = new Uint8Array(length)
  output.set(trimmed, length - trimmed.length)
  return output
}

function concatBytes(...parts: Uint8Array[]) {
  const totalLength = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(totalLength)
  let offset = 0

  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }

  return output
}

async function verifyAssertionSignature(
  storedUser: StoredUser,
  response: AuthenticatorAssertionResponse,
) {
  const key = await importPublicKey(storedUser.publicKey, storedUser.algorithm)
  const clientDataHash = await crypto.subtle.digest(
    'SHA-256',
    response.clientDataJSON,
  )
  const signedData = concatBytes(
    new Uint8Array(response.authenticatorData),
    new Uint8Array(clientDataHash),
  )
  const signature = normalizeSignature(response.signature, storedUser.algorithm)

  if (storedUser.algorithm === -7) {
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature,
      signedData,
    )
  }

  return crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    signature,
    signedData,
  )
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  return bytesToBase64Url(new Uint8Array(buffer))
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function isIpAddress(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')
}

function shortId(value: string): string {
  if (value.length <= 22) {
    return value
  }

  return `${value.slice(0, 12)}...${value.slice(-8)}`
}

function algorithmLabel(algorithm: number): string {
  if (algorithm === -7) {
    return 'ES256'
  }

  if (algorithm === -257) {
    return 'RS256'
  }

  return `COSE ${algorithm}`
}
