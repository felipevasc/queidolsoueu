from playwright.sync_api import sync_playwright, expect
import time

def verify_games_menu_and_wordle(page):
    print("Navigating to homepage...")
    page.goto("http://localhost:3000")

    # Login
    print("Logging in...")
    page.fill("#username", "testuser")
    page.fill("#password", "password")
    page.click("button:has-text('Entrar / Registrar')")

    # Wait for main menu
    print("Waiting for main menu...")
    expect(page.locator("#main-menu")).to_be_visible()

    # Click "Jogos" button
    print("Clicking 'Jogos' button...")
    page.click("button:has-text('Jogos')")

    # Check if Games Menu is visible
    print("Checking Games Menu...")
    expect(page.locator("#games-menu")).to_be_visible()

    # Take screenshot of Games Menu
    page.screenshot(path="verification/games_menu.png")
    print("Games Menu screenshot taken.")

    # Click "Adivinhe a senha"
    print("Clicking 'Adivinhe a senha'...")
    page.click("button:has-text('Adivinhe a senha')")

    # Check if Wordle Screen is visible
    print("Checking Wordle Screen...")
    expect(page.locator("#wordle-screen")).to_be_visible()

    # Check if game loaded (grid visible)
    expect(page.locator("#word-grid")).to_be_visible()

    # Take screenshot of Wordle Game
    page.screenshot(path="verification/wordle_game.png")
    print("Wordle Game screenshot taken.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_games_menu_and_wordle(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()
