import { expect, test } from '@playwright/test'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

test('registration, access gate, dosing, correction, history, export and account isolation', async ({ page, browser }) => {
  const email = `medtracker-${Date.now()}@example.test`
  const password = 'example-test-password'
  await page.goto('./#/today')
  await page.getByRole('button', { name: 'Регистрация' }).click()
  await page.getByLabel('Имя', { exact: true }).fill('Тестовый пользователь')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByLabel('Подтверждение пароля').fill(password)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { name: 'Ожидание подтверждения доступа' })).toBeVisible()
  const uid = await page.locator('.uid code').innerText()
  const environment = await initializeTestEnvironment({ projectId: 'demo-medtracker' })
  try {
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'access', uid), { enabled: true })
    })
    await page.getByRole('link', { name: 'Добавить лекарство' }).click()
    await page.getByLabel('Название', { exact: true }).fill('Тестовый препарат')
    await page.getByRole('button', { name: 'Далее' }).click()
    await page.getByLabel('Начало курса').fill('2020-01-01')
    await page.getByRole('button', { name: 'Далее' }).click()
    await page.getByRole('button', { name: 'Далее' }).click()
    await page.getByLabel('Начальный остаток').fill('5')
    await page.getByRole('button', { name: 'Далее' }).click()
    await page.getByRole('button', { name: 'Сохранить лекарство' }).click()
    await expect(page).toHaveURL(/#\/meds\/[a-zA-Z0-9]{20}$/)
    await expect(page.getByRole('heading', { name: 'Тестовый препарат', exact: true, level: 1 })).toBeVisible()
    await page.getByRole('navigation', { name: 'Главная навигация' }).getByRole('link', { name: 'Сегодня', exact: true }).click()
    await expect(page).toHaveURL(/#\/today$/)
    await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible()
    await page.getByRole('button', { name: '✓ Принял' }).click()
    await expect(page.getByText('1/1', { exact: true })).toBeVisible()
    const second = await browser.newPage({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true })
    try {
      await second.goto('./#/today')
      await second.getByLabel('Email').fill(email)
      await second.getByLabel('Пароль', { exact: true }).fill(password)
      await second.getByRole('button', { name: 'Войти', exact: true }).click()
      await expect(second.getByText('1/1', { exact: true })).toBeVisible()
      await expect(second.getByRole('navigation', { name: 'Нижняя навигация' })).toBeVisible()
      expect(await second.locator('html').evaluate(html => html.scrollWidth <= html.clientWidth)).toBe(true)
    } finally {
      await second.close()
    }

    await page.reload()
    await expect(page.getByText('1/1', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Карточка приёма «Тестовый препарат»' }).click()
    await page.getByLabel('Исправить отметку').selectOption('skipped')
    await page.getByRole('button', { name: 'Сохранить отметку' }).click()
    await expect(page.getByText('0/1', { exact: true })).toBeVisible()
    await page.getByRole('navigation', { name: 'Главная навигация' }).getByRole('link', { name: 'История', exact: true }).click()
    await page.getByLabel('Перейти к дате').fill('2020-03-04')
    await expect(page.getByRole('heading', { name: '4 марта 2020 г.' })).toBeVisible()
    await expect(page.getByText('Тестовый препарат', { exact: true })).toBeVisible()
    const csv = page.waitForEvent('download')
    await page.getByRole('button', { name: 'CSV за месяц' }).click()
    expect((await csv).suggestedFilename()).toBe('medtracker-2020-03.csv')
    await page.getByRole('navigation', { name: 'Главная навигация' }).getByRole('link', { name: 'Настройки', exact: true }).click()
    await page.getByRole('button', { name: 'Тестовое уведомление' }).click()
    await expect(page.getByText('Тестовое уведомление Medtracker.')).toBeVisible()
    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
    await expect(page.getByText('Тестовый препарат')).toHaveCount(0)

    await page.getByRole('button', { name: 'Забыли пароль?' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Отправить письмо' }).click()
    await expect(page.getByText(/на почту придёт письмо/)).toBeVisible()
  } finally {
    await environment.cleanup()
  }
})
