const { chromium } = require('playwright');

const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const DISCIPLINE_LIST_URL =
  process.env.DISCIPLINE_LIST_URL || 'https://campusdigital.pucrs.br/courses/10?actions=disciplines/';

if (!EMAIL || !PASSWORD) {
  console.error('::error title=Credenciais ausentes::Defina EMAIL e PASSWORD como secrets/variáveis.');
  process.exit(1);
}

function groupStart(title) {
  console.log(`::group::${title}`);
}
function groupEnd() {
  console.log('::endgroup::');
}
function notice(msg) {
  console.log(`::notice title=Info::${msg}`);
}
function warn(msg) {
  console.log(`::warning title=Atenção::${msg}`);
}
function fail(msg) {
  console.log(`::error title=Erro::${msg}`);
}

async function waitAndClick(page, selector, opts = {}) {
  const timeout = opts.timeout ?? 30000;
  await page.waitForSelector(selector, { timeout });
  await page.click(selector);
}

async function tryClickAvancar(page) {
  // Tenta encontrar por acessibilidade (mais robusto), senão fallback por texto
  const buttonByRole = page.getByRole('button', { name: 'Avançar', exact: false });
  if (await buttonByRole.count()) {
    await buttonByRole.first().click();
    return true;
  }
  const byTextSpan = page.locator('span.MuiButton-label', { hasText: 'Avançar' });
  if (await byTextSpan.count()) {
    await byTextSpan.first().click();
    return true;
  }
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

  // KMSI ("Manter conectado?")
  notice('Tratando "Manter conectado?" se aparecer');
  try {
    await page.waitForSelector('#KmsiCheckboxField', { timeout: 15000 });
    await page.click('input[type="submit"]');
  } catch (_) {
    warn('Tela "Manter conectado?" não apareceu (ok).');
  }

  // Página home
  notice('Aguardando home do Campus Digital');
  await page.waitForURL('**/home', { timeout: 60000 });
  groupEnd();
}

async function openDisciplines(page) {
  groupStart('Navegar para disciplinas');
  notice('Clicando em "Ver Disciplinas"');
  await waitAndClick(page, 'button[data-cy="buttonSeeDisciplines"]');

  notice('Aguardando lista de disciplinas carregar');
  await page.waitForLoadState('networkidle', { timeout: 60000 });

  // Se veio redirecionado para outra URL, navega explicitamente para a lista desejada (fallback)
  if (!page.url().includes('/courses/') || !page.url().includes('disciplines')) {
    warn('Redirecionamento diferente do esperado; navegando para URL de disciplinas definida.');
    await page.goto(DISCIPLINE_LIST_URL, { waitUntil: 'domcontentloaded' });
  }

  notice('Coletando os dois primeiros links de disciplinas');
  const links = await page.$$eval(
    'a.MuiTypography-root.MuiLink-root.MuiLink-underlineHover.MuiTypography-colorPrimary',
    (els) => els.slice(0, 2).map((e) => e.href)
  );

  if (!links.length) {
    throw new Error('Nenhuma disciplina encontrada na lista.');
  }

  console.log('Links encontrados:', links);
  groupEnd();
  return links.slice(0, 2);
}

async function playAndWaitForVideo(page) {
  // Procura elemento <video> e tenta dar play se estiver pausado
  const video = page.locator('video').first();

  if (!(await video.count())) {
    warn('Nenhum elemento <video> encontrado nesta página.');
    return false;
  }

  notice('Vídeo encontrado; garantindo que está em reprodução até o término.');
  // Se houver botão de play dedicado, clique
  const playBtn = page.locator('button[data-play-button="true"]').first();
  if (await playBtn.count()) {
    await playBtn.click().catch(() => {});
  }

  // Força play via JS caso necessário
  try {
    await video.evaluate(async (v) => {
      // Tenta iniciar
      if (v.paused) {
        await v.play().catch(() => {});
      }
    });
  } catch (_) {
    // ignora
  }

  // Aguarda até 'ended === true', com timeout amplo
  const maxWaitMs = 3 * 60 * 60 * 1000; // 3 horas máx por aula (ajuste se quiser)
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const { ended, currentTime, duration, paused } = await video.evaluate((v) => ({
      ended: v.ended,
      currentTime: v.currentTime || 0,
      duration: v.duration || 0,
      paused: v.paused
    }));

    console.log(`Progresso do vídeo: ${currentTime.toFixed(1)}s / ${isFinite(duration) ? duration.toFixed(1) : '??'}s`);

    if (ended) {
      notice('Vídeo terminou.');
      return true;
    }

    // Se pausado no meio, tenta retomar
    if (paused) {
      try {
        await video.evaluate((v) => v.play());
      } catch (_) {}
    }

    await new Promise((r) => setTimeout(r, 5000));
  }

  warn('Timeout ao aguardar o término do vídeo.');
  return false;
}

async function processDisciplina(page, link, idx) {
  groupStart(`Disciplina ${idx + 1}`);
  notice(`Abrindo disciplina: ${link}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 60000 });

  let passos = 0;
  while (true) {
    passos++;
    groupStart(`Aula/Página ${passos}`);

    // Tenta assistir vídeo se existir
    const hadVideo = await playAndWaitForVideo(page);

    // Tenta avançar
    const avançou = await tryClickAvancar(page);
    if (!avançou) {
      notice('Botão "Avançar" não existe mais. Fim da disciplina.');
      groupEnd();
      break;
    }

    notice('Avançando para a próxima página/aula.');
    // Aguarda carregamento da próxima página
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 });

    groupEnd();
  }

  groupEnd();
}

(async () => {
  const browser = await chromium.launch({
    headless: true // no CI grava vídeo/trace; local pode mudar para false se quiser ver
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    recordVideo: { dir: 'session-videos', size: { width: 1280, height: 720 } }
  });

  const page = await context.newPage();

  // Trace para auditoria
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  try {
    await ensureLoggedIn(page);
    const links = await openDisciplines(page);

    for (let i = 0; i < links.length; i++) {
      await processDisciplina(page, links[i], i);
      // Após concluir a primeira, volta para lista, coleta novamente (caso URL mude)
      if (i === 0) {
        groupStart('Retornar à lista de disciplinas');
        await page.goto(DISCIPLINE_LIST_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 60000 });
        groupEnd();
      }
    }

    notice('Todas as aulas das duas disciplinas foram processadas com sucesso.');
  } catch (err) {
    fail(`Falha na automação: ${err.message}`);
    process.exitCode = 1;
  } finally {
    // Salva trace
    await context.tracing.stop({ path: 'playwright-trace.zip' });
    await context.close();
    await browser.close();
  }
})();
