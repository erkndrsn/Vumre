import { test, expect } from '@playwright/test'

test('girişsiz kullanıcı login sayfasına yönlendirilir', async ({ page }) => {
  // Payload çalışmıyor olsa bile oturum yok sayılır.
  await page.route('**/api/*/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' }),
  )

  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator('h1')).toHaveText('Giriş yap')
})

test('korumalı sayfa adresi redirect parametresinde korunur', async ({ page }) => {
  await page.route('**/api/*/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' }),
  )

  await page.goto('/bir-sayfa')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fbir-sayfa/)
})
