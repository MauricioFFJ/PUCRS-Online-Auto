const { chromium } = require('playwright');

const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('::error title=Credenciais ausentes::Defina EMAIL e PASSWORD como secrets/variáveis.');
  process.exit(1);
}

function groupStart(title) { console.log(`::group::${title}`); }
function groupEnd() { console.log('::endgroup::'); }
function notice(msg) { console.log(`::notice title=Info::${msg}`); }
function warn(msg) { console.log(`::warning title=Atenção::${msg}`); }
function fail(msg) { console.log(`::error title=Erro::${msg}`); }

async function waitAndClick(page, selector, opts = {}) {
  const timeout = opts.timeout ?? 30000;
  await page.waitForSelector(selector, { timeout });
  await page.click(selector);
}

async function tryClickAvancar(page) {
  const byRole = page.getByRole('button', { name: /Avan\w*çar/i });
  if (await byRole.count()) { await byRole.first().click(); return true; }
  const bySpan = page.locator('button:has(span.MuiButton-label:has-text("Avançar"))');
  if (await bySpan.count()) { await bySpan.first().click(); return true; }
  const byText = page.locator('text=Avançar');
  if (await byText.count()) { await byText.first().click(); return true; }
  return false;
}

async function ensureLoggedIn(page) {
  groupStart('Login');
  notice('Abrindo página de login do Campus Digital');
  await page.goto('https://campusdigital.pucrs.br/login', { waitUntil: 'domcontentloaded' });
  notice('Clicando em "Entrar"');
  await waitAndClick(page, 'button:has-text("Entrar")');
  notice('Aguardando campo de e-mail');
  await page.waitForSelector('input[type="email"]', { timeout: 45000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.click('input[type="submit"]');
  notice('Aguardando campo de senha');
  await page.waitForSelector('input[name="passwd"]', { timeout: 45000 });
  await page.fill('input[name="passwd"]', PASSWORD);
  await page.click('input[type="submit"]');
  notice('Tratando "Manter conectado?" se aparecer');
  try {
    await page.waitForSelector('#KmsiCheckboxField', { timeout: 15000 });
    await page.click('input[type="submit"]');
  } catch { warn('Tela "Manter conectado?" não apareceu (ok).'); }
  notice('Aguardando home do Campus Digital');
  await page.waitForURL('**/home', { timeout: 60000 });
  groupEnd();
}

async function openDisciplines(page) {
  groupStart('Navegar para disciplinas');
  notice('Clicando em "Ver Disciplinas"');
  await waitAndClick(page, 'button[data-cy="buttonSeeDisciplines"]');
  notice('Aguardando lista de disciplinas aparecer');
  await page.waitForSelector(
    'a.MuiTypography-root.MuiLink-root.MuiLink-underlineHover.MuiTypography-colorPrimary',
    { timeout: 60000 }
  );
  notice('Coletando os dois primeiros links de disciplinas');
  const links = await page.$$eval(
    'a.MuiTypography-root.MuiLink-root.MuiLink-underlineHover.MuiTypography-colorPrimary',
    els => els.slice(0, 2).map(e => e.href)
  );
  if (!links.length) throw new Error('Nenhuma disciplina encontrada.');
  console.log('Links encontrados:', links);
  groupEnd();
  return links.slice(0, 2);
}

function parseTimeToMs(timeStr) {
  const s = (timeStr || '').trim().toLowerCase();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
    const parts = s.split(':').map(n => parseInt(n, 10));
    let seconds = 0;
    if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    return (seconds + 60) * 1000;
  }
  let hours = 0, minutes = 0, seconds = 0;
  const hMatch = s.match(/(\d+)\s*h/);
  const mMatch = s.match(/(\d+)\s*m/);
  const secMatch = s.match(/(\d+)\s*s/);
  if (hMatch) hours = parseInt(hMatch[1], 10);
  if (mMatch) minutes = parseInt(mMatch[1], 10);
  if (secMatch) seconds = parseInt(secMatch[1], 10);
  if (hMatch || mMatch || secMatch) {
    const total = hours * 3600 + minutes * 60 + seconds;
    return (total + 60) * 1000;
  }
  return 5 * 60 * 1000;
}

async function logLessonContext(page) {
  try {
    const tempo = await page.locator('p[data-cy="timePartLesson"]').first().innerText({ timeout: 4000 });
    notice(`Tempo informado na página: ${tempo}`);
  } catch {}
  try {
    const info = await page.locator('div.infoCard').first().innerText({ timeout: 2000 });
    if (info && info.trim()) notice(`infoCard: ${info.trim()}`);
  } catch {}
  try {
    const part = await page.locator('div[data-cy="partLesson"]').first().innerText({ timeout: 2000 });
    if (part && part.trim()) notice(`partLesson: ${part.trim()}`);
  } catch {}
}

async function clickPlay(page) {
  const overlayPlay = page.locator('button[data-play-button="true"]').first();
  if (await overlayPlay.count()) {
    notice('Play overlay encontrado, clicando...');
    try {
      await overlayPlay.click({ timeout: 5000 });
      return true;
    } catch {}
  }
  const vimeoFrame = page.locator('iframe[src*="player.vimeo.com"]').first();
  if (await vimeoFrame.count()) {
    notice('Iframe do Vimeo encontrado; clicando no centro para iniciar.');
    try {
      await vimeoFrame.waitFor({ state: 'visible', timeout: 10000 });
      await vimeoFrame.scrollIntoViewIfNeeded();
      await vimeoFrame.click({ position: { x: 50, y: 50 } });
      await page.waitForTimeout(500);
      await vimeoFrame.click({ position: { x: 50, y: 50 } });
      return true;
    } catch {}
    try {
      notice('Tentando iniciar com tecla Espaço focando o iframe.');
      const frameHandle = await vimeoFrame.elementHandle();
      if (frameHandle) {
        await frameHandle.focus();
        await page.keyboard.press('Space');
        await page.waitForTimeout(500);
        return true;
      }
    } catch {}
  }
  warn('Não foi possível acionar o play.');
  return false;
}

async function playAndWaitForVideo(page) {
  await logLessonContext(page);
  let tempoMs;
  try {
    const tempoTexto = await page.locator('p[data-cy="timePartLesson"]').first().innerText({ timeout: 6000 });
    tempoMs = parseTimeToMs(tempoTexto.trim());
    notice(`Tempo da aula: ${tempoTexto} (+1 min) => aguardar ~${Math.round(tempoMs / 1000)}s`);
  } catch {
    warn('Não foi possível ler o tempo da aula. Usando 5min como fallback.');
    tempoMs = 5 * 60 * 1000;
  }
  const started = await clickPlay(page);
  if (!started) warn('Prosseguindo mesmo sem confirmação do play.');
  await page.waitForTimeout(1500);
  await page.waitForTimeout(tempoMs);
  return true;
}

async function processDisciplina(page, link, idx) {
  groupStart(`Disciplina ${idx + 1}`);
  notice(`Abrindo disciplina: ${link}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  let passos = 0;
  while (true) {
    passos++;
    groupStart(`Aula/Página ${passos}`);
    await playAndWait
        await playAndWaitForVideo(page);

    const avancou = await tryClickAvancar(page);
    if (!avancou) {
      notice('Botão "Avançar" não existe mais. Fim da disciplina.');
      groupEnd();
      break;
    }
    notice('Avançando para a próxima página/aula.');
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 });

    groupEnd();
  }
  groupEnd();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    recordVideo: { dir: 'session-videos', size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  try {
    await ensureLoggedIn(page);
    const links = await openDisciplines(page);

    // Primeira disciplina
    await processDisciplina(page, links[0], 0);

    // Voltar para lista e abrir segunda disciplina
    groupStart('Retornando à lista de disciplinas');
    await page.goto('https://campusdigital.pucrs.br/home', { waitUntil: 'domcontentloaded' });
    await waitAndClick(page, 'button[data-cy="buttonSeeDisciplines"]');
    await page.waitForSelector(
      'a.MuiTypography-root.MuiLink-root.MuiLink-underlineHover.MuiTypography-colorPrimary',
      { timeout: 60000 }
    );
    groupEnd();

    const linksNovos = await page.$$eval(
      'a.MuiTypography-root.MuiLink-root.MuiLink-underlineHover.MuiTypography-colorPrimary',
      els => els.slice(0, 2).map(e => e.href)
    );

    await processDisciplina(page, linksNovos[1], 1);

    notice('Todas as aulas das duas disciplinas foram processadas com sucesso.');
  } catch (err) {
    fail(`Falha na automação: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await context.tracing.stop({ path: 'playwright-trace.zip' });
    await context.close();
    await browser.close();
  }
})();
