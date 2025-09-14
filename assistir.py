from playwright.sync_api import sync_playwright
import os
import re
import time

# Funções de log no padrão GitHub Actions
def group_start(title):
    print(f"::group::{title}")

def group_end():
    print("::endgroup::")

def notice(msg):
    print(f"::notice title=Info::{msg}")

def warn(msg):
    print(f"::warning title=Atenção::{msg}")

def fail(msg):
    print(f"::error title=Erro::{msg}")

EMAIL = os.getenv("EMAIL")
PASSWORD = os.getenv("PASSWORD")

if not EMAIL or not PASSWORD:
    fail("Defina EMAIL e PASSWORD como variáveis de ambiente.")
    exit(1)

def parse_time_to_seconds(time_str):
    s = time_str.strip().lower()
    if re.match(r"^\d{1,2}:\d{2}(:\d{2})?$", s):
        parts = list(map(int, s.split(":")))
        if len(parts) == 2:
            seconds = parts[0] * 60 + parts[1]
        else:
            seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
        return seconds + 60
    h = re.search(r"(\d+)\s*h", s)
    m = re.search(r"(\d+)\s*m", s)
    sec = re.search(r"(\d+)\s*s", s)
    hours = int(h.group(1)) if h else 0
    minutes = int(m.group(1)) if m else 0
    seconds = int(sec.group(1)) if sec else 0
    if h or m or sec:
        return hours * 3600 + minutes * 60 + seconds + 60
    return 5 * 60

def click_play(page):
    overlay = page.locator('button[data-play-button="true"]').first
    if overlay.count():
        try:
            notice("Play overlay encontrado, clicando...")
            overlay.click(timeout=3000)
            return True
        except:
            pass
    vimeo = page.locator('iframe[src*="player.vimeo.com"]').first
    if vimeo.count():
        notice("Iframe do Vimeo encontrado; clicando no centro para iniciar.")
        vimeo.wait_for(state="visible", timeout=10000)
        box = vimeo.bounding_box()
        if box:
            page.mouse.click(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
            time.sleep(0.5)
            page.mouse.click(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
            return True
    warn("Não foi possível acionar o play.")
    return False

def assistir_disciplina(page, link):
    group_start(f"Disciplina: {link}")
    page.goto(link)
    passo = 0
    while True:
        passo += 1
        group_start(f"Aula/Página {passo}")
        try:
            tempo_txt = page.locator('p[data-cy="timePartLesson"]').first.inner_text(timeout=5000)
            tempo_seg = parse_time_to_seconds(tempo_txt)
            notice(f"Tempo da aula: {tempo_txt} (+1 min) => aguardando {tempo_seg}s")
        except:
            tempo_seg = 5 * 60
            warn("Tempo não encontrado, usando 5min como fallback.")

        started = click_play(page)
        if not started:
            warn("Prosseguindo mesmo sem confirmação do play.")

        time.sleep(tempo_seg)

        avancar = page.get_by_role("button", name=re.compile("Avançar", re.I))
        if avancar.count():
            notice("Avançando para a próxima página/aula.")
            avancar.first.click()
            page.wait_for_load_state("domcontentloaded")
        else:
            notice("Fim da disciplina.")
            group_end()
            break
        group_end()
    group_end()

with sync_playwright() as p:
    group_start("Iniciando script")
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1366, "height": 768})
    page = context.new_page()

    group_start("Login")
    notice("Abrindo página de login do Campus Digital")
    page.goto("https://campusdigital.pucrs.br/login")
    notice('Clicando em "Entrar"')
    page.click('button:has-text("Entrar")')
    notice("Aguardando campo de e-mail")
    page.fill('input[type="email"]', EMAIL)
    page.click('input[type="submit"]')
    notice("Aguardando campo de senha")
    page.fill('input[name="passwd"]', PASSWORD)
    page.click('input[type="submit"]')
    notice('Tratando "Manter conectado?" se aparecer')
    try:
        page.wait_for_selector('#KmsiCheckboxField', timeout=5000)
        page.click('input[type="submit"]')
    except:
        warn('Tela "Manter conectado?" não apareceu (ok).')
    page.wait_for_url("**/home")
    group_end()

    group_start("Navegar para disciplinas")
    notice('Clicando em "Ver Disciplinas"')
    page.click('button[data-cy="buttonSeeDisciplines"]')
    notice("Aguardando lista de disciplinas aparecer")
    page.wait_for_selector('a.MuiTypography-root.MuiLink-root')
    links = page.eval_on_selector_all(
        'a.MuiTypography-root.MuiLink-root',
        'els => els.slice(0, 2).map(e => e.href)'
    )
    notice(f"Links encontrados: {links}")
    group_end()

    assistir_disciplina(page, links[0])

    group_start("Retornando à lista de disciplinas")
    page.goto("https://campusdigital.pucrs.br/home")
    page.click('button[data-cy="buttonSeeDisciplines"]')
    page.wait_for_selector('a.MuiTypography-root.MuiLink-root')
    links2 = page.eval_on_selector_all(
        'a.MuiTypography-root.MuiLink-root',
        'els => els.slice(0, 2).map(e => e.href)'
    )
    group_end()

    assistir_disciplina(page, links2[1])

    browser.close()
    group_end()
