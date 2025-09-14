from playwright.sync_api import sync_playwright
import os
import re
import time

EMAIL = os.getenv("EMAIL")
PASSWORD = os.getenv("PASSWORD")

if not EMAIL or not PASSWORD:
    print("Defina EMAIL e PASSWORD como variáveis de ambiente.")
    exit(1)

def parse_time_to_seconds(time_str):
    s = time_str.strip().lower()
    # Formato mm:ss ou hh:mm:ss
    if re.match(r"^\d{1,2}:\d{2}(:\d{2})?$", s):
        parts = list(map(int, s.split(":")))
        if len(parts) == 2:
            seconds = parts[0] * 60 + parts[1]
        else:
            seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
        return seconds + 60
    # Formato 18m, 1h 05m, etc.
    h = re.search(r"(\d+)\s*h", s)
    m = re.search(r"(\d+)\s*m", s)
    sec = re.search(r"(\d+)\s*s", s)
    hours = int(h.group(1)) if h else 0
    minutes = int(m.group(1)) if m else 0
    seconds = int(sec.group(1)) if sec else 0
    if h or m or sec:
        return hours * 3600 + minutes * 60 + seconds + 60
    return 5 * 60  # fallback

def click_play(page):
    # Tenta overlay
    overlay = page.locator('button[data-play-button="true"]').first
    if overlay.count():
        try:
            overlay.click(timeout=3000)
            return True
        except:
            pass
    # Tenta iframe do Vimeo
    vimeo = page.locator('iframe[src*="player.vimeo.com"]').first
    if vimeo.count():
        vimeo.wait_for(state="visible", timeout=10000)
        box = vimeo.bounding_box()
        if box:
            page.mouse.click(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
            time.sleep(0.5)
            page.mouse.click(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
            return True
    return False

def assistir_disciplina(page, link):
    page.goto(link)
    passo = 0
    while True:
        passo += 1
        print(f"\n--- Aula/Página {passo} ---")
        try:
            tempo_txt = page.locator('p[data-cy="timePartLesson"]').first.inner_text(timeout=5000)
            tempo_seg = parse_time_to_seconds(tempo_txt)
            print(f"Tempo da aula: {tempo_txt} (+1 min) => aguardando {tempo_seg}s")
        except:
            tempo_seg = 5 * 60
            print("Tempo não encontrado, usando 5min como fallback.")

        started = click_play(page)
        if not started:
            print("Não foi possível confirmar o play, prosseguindo assim mesmo.")

        time.sleep(tempo_seg)

        # Avançar
        avancar = page.get_by_role("button", name=re.compile("Avançar", re.I))
        if avancar.count():
            avancar.first.click()
            page.wait_for_load_state("domcontentloaded")
        else:
            print("Fim da disciplina.")
            break

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    context = browser.new_context(viewport={"width": 1366, "height": 768})
    page = context.new_page()

    # Login
    print("Login...")
    page.goto("https://campusdigital.pucrs.br/login")
    page.click('button:has-text("Entrar")')
    page.fill('input[type="email"]', EMAIL)
    page.click('input[type="submit"]')
    page.fill('input[name="passwd"]', PASSWORD)
    page.click('input[type="submit"]')
    try:
        page.wait_for_selector('#KmsiCheckboxField', timeout=5000)
        page.click('input[type="submit"]')
    except:
        pass
    page.wait_for_url("**/home")

    # Disciplinas
    page.click('button[data-cy="buttonSeeDisciplines"]')
    page.wait_for_selector('a.MuiTypography-root.MuiLink-root')
    links = page.eval_on_selector_all(
        'a.MuiTypography-root.MuiLink-root',
        'els => els.slice(0, 2).map(e => e.href)'
    )
    print("Links encontrados:", links)

    # Primeira disciplina
    assistir_disciplina(page, links[0])

    # Segunda disciplina
    page.goto("https://campusdigital.pucrs.br/home")
    page.click('button[data-cy="buttonSeeDisciplines"]')
    page.wait_for_selector('a.MuiTypography-root.MuiLink-root')
    links2 = page.eval_on_selector_all(
        'a.MuiTypography-root.MuiLink-root',
        'els => els.slice(0, 2).map(e => e.href)'
    )
    assistir_disciplina(page, links2[1])

    browser.close()
