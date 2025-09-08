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
  const buttonByRole = page.getByRole('button', { name: 'Avançar', exact: false });
  if (await buttonByRole.count()) { await buttonByRole.first().click(); return true; }
  const byTextSpan = page.locator('span.MuiButton-label', { hasText: 'Avançar' });
  if (await byTextSpan.count()) { await byTextSpan.first().click(); return true; }
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

async function playAndWaitForVideo(page) {
  const video = page.locator('video').first();
  if (!(await video.count())) { warn('Nenhum vídeo encontrado nesta página.'); return false; }

  notice('Vídeo encontrado; aguardando até o término.');
  const playBtn = page.locator('button[data-play-button="true"]').first();
  if (await playBtn.count()) await playBtn.click().catch(() => {});

  try { await video.evaluate(async v => { if (v.paused) await v.play().catch(() => {}); }); } catch {}

  const maxWaitMs = 3 * 60 * 60 * 1000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { ended, currentTime, duration, paused } = await video.evaluate(v => ({
      ended: v.ended, currentTime: v.currentTime || 0, duration: v.duration || 0, paused: v.paused
    }));

    console.log(`Progresso: ${currentTime.toFixed(1)}s / ${isFinite(duration) ? duration.toFixed(1) : '??'}s`);
    if (ended) { notice('Vídeo finalizado.'); return true; }
    if (paused) { try { await video.evaluate(v => v.play()); } catch {} }
    await new Promise(r => setTimeout(r, 5000));
  }
  warn('Timeout aguardando vídeo.');
  return false;
}

async function processDisciplina(page, link, idx) {
  groupStart(`Disciplina ${idx + 1}`);
  notice(`Abrindo disciplina: ${link}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });

  let passos = 0;
  while (true) {
    passos++;
    groupStart(`Aula/Página ${passos}`);
    await playAndWaitForVideo(page);
    const avancou = await tryClickAvancar(page);
    if (!avancou) { notice('Botão "Avançar" não existe mais. Fim da disciplina.'); groupEnd(); break; }
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

    // Segunda disciplina
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
