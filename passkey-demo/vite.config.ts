export default {
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        passkey: 'passkey.html',
        passwordCredentials: 'password-credentials.html',
      },
    },
  },
}
