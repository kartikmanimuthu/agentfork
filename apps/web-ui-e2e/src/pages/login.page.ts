import { type Page, type Locator } from '@playwright/test';
import { ROUTES } from '../constants/routes';

/**
 * Page object for the credentials login and register pages.
 * Exposes the locators the auth specs assert against, plus navigation.
 */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(ROUTES.login, { waitUntil: 'domcontentloaded' });
  }

  async gotoRegister(): Promise<void> {
    await this.page.goto(ROUTES.register, { waitUntil: 'domcontentloaded' });
  }

  get heading(): Locator {
    return this.page.getByRole('heading', { name: /Sign in/i });
  }

  get emailInput(): Locator {
    return this.page.getByPlaceholder('Email');
  }

  get passwordInput(): Locator {
    return this.page.getByPlaceholder('Password');
  }

  get signInButton(): Locator {
    return this.page.getByRole('button', { name: /Sign in$/i });
  }

  get ssoButton(): Locator {
    return this.page.getByRole('button', { name: /SSO/i });
  }

  // Register page
  get registerHeading(): Locator {
    return this.page.getByRole('heading', { name: /Create account/i });
  }

  get nameInput(): Locator {
    return this.page.getByPlaceholder('Name');
  }

  get createAccountButton(): Locator {
    return this.page.getByRole('button', { name: /Create account/i });
  }

  get signInLink(): Locator {
    return this.page.getByRole('link', { name: /Sign in/i });
  }
}
