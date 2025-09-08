const { chromium } = require('playwright');

const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const DISCIPLINE_LIST_URL =
  process.env.DISCIPLINE_LIST_URL || 'https://campusdigital.pucrs.br/courses/10?actions=disciplines/';

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
  // 1) Buscar por role
  const byRole = page.getByRole('button', { name: /Avan\w*çar/i });
  if (await byRole.count()) { await byRole.first().click(); return true; }

  // 2) Botão com span label
  const bySpan = page.locator('button:has(span.MuiButton-label:has-text("Avançar"))');
  if (await bySpan.count()) { await bySpan.first().click(); return true; }

  // 3) Qualquer elemento com texto "Avançar"
  const byText = page.locator('text="Avançar"');
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

// Parse de durações:
// - "18m", "1h", "1h 05m", "45s"
// - "mm:ss", "hh:mm:ss"
function parseTimeToMs(timeStr) {
  const s = (timeStr || '').trim().toLowerCase();

  // Formatos "hh:mm:ss" ou "mm:ss"
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
    const parts = s.split(':').map(n => parseInt(n, 10));
    let seconds = 0;
    if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    return (seconds + 60) * 1000; // +1 min
  }

  // Formatos "1h 05m", "18m", "45s", "1h"
  let hours = 0, minutes = 0, seconds = 0;
  const hMatch = s.match(/(\d+)\s*h/);
  const mMatch = s.match(/(\d+)\s*m/);
  const secMatch = s.match(/(\d+)\s*s/);
  if (hMatch) hours = parseInt(hMatch[1], 10);
  if (mMatch) minutes = parseInt(mMatch[1], 10);
  if (secMatch) seconds = parseInt(secMatch[1], 10);

  if (hMatch || mMatch || secMatch) {
    const total = hours * 3600 + minutes * 60 + seconds;
    return (total + 60) * 1000; // +1 min
  }

  // Fallback
  return 5 * 60 * 1000;
}

// Tenta clicar no play:
// 1) Botão overlay na própria página (data-play-button)
// 2) Clique no centro do iframe do Vimeo (cross-origin) para iniciar playback
async function clickPlay(page) {
  // 1) Botão overlay da página (quando disponível)
  const overlayPlay = page.locator('button[data-play-button="true"]').first();
  if (await overlayPlay.count()) {
    notice('Play overlay encontrado, clicando...');
    try {
      await overlayPlay.click({ timeout: 5000 });
      return true;
    } catch { /* segue para iframe */ }
  }

  // 2) Iframe do Vimeo: clicar no centro para iniciar
  const vimeoFrame = page.locator('iframe[src*="player.vimeo.com"]').first();
  if (await vimeoFrame.count()) {
    notice('Iframe do Vimeo encontrado; clicando no centro para iniciar.');
    try {
      const box = await vimeoFrame.boundingBox();
      if (box) {
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.click(x, y);
        return true;
      }
    } catch { /* ignora */ }
  }

  // 3) Qualquer iframe de player (fallback genérico)
  const anyFrame = page.locator('iframe').first();
  if (await anyFrame.count()) {
    notice('Tentando iniciar via clique no centro do primeiro iframe.');
    try {
      const box = await anyFrame.boundingBox();
      if (box) {
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.click(x, y);
        return true;
      }
    } catch { /* ignora */ }
  }

  warn('Não foi possível acionar o play (overlay/iframe).');
  return false;
}

async function logLessonContext(page) {
  // p[data-cy="timePartLesson"]
  try {
    const tempo = await page.locator('p[data-cy="timePartLesson"]').first().innerText({ timeout: 4000 });
    notice(`Tempo informado na página: ${tempo}`);
  } catch { /* silencioso */ }

  // div.infoCard (se existir)
  try {
    const info = await page.locator('div.infoCard').first().innerText({ timeout: 2000 });
    if (info && info.trim()) notice(`infoCard: ${info.trim().slice(0, 200)}`);
  } catch { /* silencioso */ }

  // div[data-cy="partLesson"] (se existir)
  try {
    const part = await page.locator('div[data-cy="partLesson"]').first().innerText({ timeout: 2000 });
    if (part && part.trim()) notice(`partLesson: ${part.trim().slice(0, 200)}`);
  } catch { /* silencioso */ }
}

async function playAndWaitForVideo(page) {
  // Log de contexto da aula
  await logLessonContext(page);

  // Ler tempo da aula
  let tempoMs = null;
  try {
    const tempoTexto = await page.locator('p[data-cy="timePartLesson"]').first().innerText({ timeout: 5000 });
    tempoMs = parseTimeToMs(tempoTexto.trim());
    notice(`Tempo da aula detectado: ${tempoTexto} (+1 min) => aguardar ${Math.round(tempoMs / 1000)}s`);
  } catch {
    warn('Não foi possível ler o tempo da aula. Usando tempo padrão de 5 minutos (+1 min embutido).');
    tempoMs = 5 * 60 * 1000;
  }

  // Garantir que o player começa a tocar
  await clickPlay(page);
  await page.waitForTimeout(2000); // pequena margem para iniciar

  // Esperar o tempo calculado
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

    // Tenta tocar/aguardar o vídeo pelo tempo indicado
    await playAndWaitForVideo(page);

    // Avançar
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
