import { test, expect } from '@playwright/test'

test.describe('Frontend', () => {
  test('serves the Vue app on the homepage', async ({ page }) => {
    await page.goto('http://localhost:630')

    // Oturum yokken Vue router giriş sayfasına yönlendirir.
    await expect(page).toHaveURL(/\/login/)
    await expect(page).toHaveTitle(/Vumre/)
    await expect(page.getByRole('button', { name: 'Giriş yap' })).toBeVisible()
  })
})
