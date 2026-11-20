import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
}
const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
const app = useEmulators
  ? initializeApp({ apiKey: 'demo-medtracker', projectId: 'demo-medtracker' })
  : config.apiKey && config.authDomain && config.projectId && config.appId
    ? initializeApp(config)
    : null

export const firebase = app ? { auth: getAuth(app), db: getFirestore(app) } : null
if (useEmulators && firebase) {
  connectAuthEmulator(firebase.auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(firebase.db, '127.0.0.1', 8080)
}

export function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return 'Не удалось выполнить операцию.'
  const code = (error as Error & { code?: string }).code
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Проверьте email и пароль.',
    'auth/invalid-email': 'Проверьте адрес электронной почты.',
    'auth/email-already-in-use': 'Аккаунт с таким адресом уже существует.',
    'auth/weak-password': 'Пароль слишком короткий.',
    'auth/unauthorized-domain': 'Домен сайта не разрешён в настройках Firebase Authentication.',
    'auth/invalid-api-key': 'Проверьте настройки подключения Firebase.',
    'auth/network-request-failed': 'Нет связи с Firebase. Проверьте подключение.',
    'auth/too-many-requests': 'Слишком много попыток. Повторите позже.',
    'permission-denied': 'Нет доступа для выполнения операции.',
    'failed-precondition': 'Обновите страницу. Если ошибка сохраняется, проверьте индексы Firestore.',
    unavailable: 'Нет связи с Firebase. Операция не подтверждена.',
    aborted: 'Данные одновременно изменились. Повторите операцию.',
  }
  return code ? messages[code] ?? 'Сервис временно недоступен. Повторите попытку.' : error.message
}
