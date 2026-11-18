/**
 * Évaluation de l'IA médiatrice contre le VRAI modèle Gemini.
 *
 *   npm run eval:ai              → chaque cas joué 3 fois
 *   EVAL_RUNS=5 npm run eval:ai  → 5 fois (plus de confiance, plus de coût)
 *   EVAL_ONLY=C npm run eval:ai  → seulement les cas dont l'id commence par C
 *
 * Coût indicatif : ~0,0006 $ par appel → 33 cas × 3 = ~0,06 $.
 * Code de sortie 1 si un contrôle échoue (utilisable avant chaque mise en prod).
 * Rapport détaillé : test/ai-eval/reports/<date>.json (non versionné).
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import configuration from '../../src/config/configuration';
import { AiService, type AiDraftResult } from '../../src/modules/ai/ai.service';
import { BASE_CTX, CASES, type EvalCase } from './cases';

const RUNS = Number(process.env.EVAL_RUNS ?? 3);
const ONLY = process.env.EVAL_ONLY;
const CONCURRENCY = 4;

// ─── Contrôles génériques ────────────────────────────────────────────────────

const STOPWORDS: Record<string, string[]> = {
  fr: [
    'le',
    'la',
    'les',
    'des',
    'que',
    'qui',
    'est',
    'une',
    'pour',
    'vous',
    'avec',
    'dans',
    'pas',
    'elle',
    'il',
  ],
  en: [
    'the',
    'to',
    'and',
    'you',
    'that',
    'is',
    'for',
    'with',
    'your',
    'have',
    'will',
    'she',
    'he',
    'would',
  ],
  es: [
    'el',
    'los',
    'las',
    'que',
    'para',
    'usted',
    'con',
    'por',
    'una',
    'es',
    'su',
    'si',
    'puede',
    'ella',
  ],
  de: [
    'der',
    'die',
    'das',
    'und',
    'sie',
    'ist',
    'nicht',
    'mit',
    'zu',
    'ein',
    'eine',
    'für',
    'ihnen',
    'dass',
  ],
};

/** Tutoiement interdit dans le message reçu par le Target. */
const INFORMAL: Record<string, RegExp> = {
  fr: /(^|[^\p{L}])(tu|te|toi|ton|ta|tes|t')(?=$|[^\p{L}])/iu,
  es: /(^|[^\p{L}])(tú|ti|contigo|tu|tus|te)(?=$|[^\p{L}])/iu,
  de: /(^|[^\p{L}])(du|dich|dir|dein|deine|deinen|deinem|deiner)(?=$|[^\p{L}])/iu,
};

/** Le message ne doit jamais être écrit à la première personne du Sender. */
const FIRST_PERSON: Record<string, RegExp> = {
  fr: /(^|[^\p{L}])(je|j'|moi|mon|ma|mes|me|m')(?=$|[^\p{L}])/iu,
  en: /(^|[^\p{L}])(i|i'm|i'll|my|me|mine)(?=$|[^\p{L}])/iu,
  es: /(^|[^\p{L}])(yo|mi|mis|me|conmigo)(?=$|[^\p{L}])/iu,
  de: /(^|[^\p{L}])(ich|mein|meine|mich|mir)(?=$|[^\p{L}])/iu,
};

const OBJECTIVE_START: Record<string, RegExp> = {
  fr: /^vous\b/i,
  en: /^you\b/i,
};

/** Comparaison tolérante aux espaces (1 250,50 = 1 250,50 = 1250,50) et à la casse. */
const norm = (s: string) => s.toLowerCase().replace(/[\s\u00a0\u202f]/g, '');
/** « a|b » : l'une ou l'autre écriture suffit. */
const has = (text: string, needle: string) =>
  needle.split('|').some((n) => norm(text).includes(norm(n)));

function detectLang(text: string): string {
  const words = text.toLowerCase().split(/[^\p{L}']+/u);
  let best = '';
  let bestScore = -1;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const score = words.filter((w) => list.includes(w)).length;
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return best;
}

function check(c: EvalCase, r: AiDraftResult): string[] {
  const ctx = { ...BASE_CTX, ...c.ctx };
  const errors: string[] = [];
  const actual = r.notice ?? (r.draftChanged ? 'draft' : 'unchanged');
  if (actual !== c.outcome) {
    errors.push(`résultat « ${actual} » au lieu de « ${c.outcome} »`);
    return errors;
  }
  const obj = r.objectiveMessage;
  const real = r.realMessage;

  for (const n of c.include ?? []) {
    if (!has(obj, n)) errors.push(`objectif sans « ${n} »`);
    if (!has(real, n)) errors.push(`message sans « ${n} »`);
  }
  for (const n of c.objInclude ?? [])
    if (!has(obj, n)) errors.push(`objectif sans « ${n} »`);
  for (const n of c.realInclude ?? [])
    if (!has(real, n)) errors.push(`message sans « ${n} »`);
  for (const n of c.exclude ?? []) {
    if (has(obj, n)) errors.push(`objectif contient « ${n} »`);
    if (has(real, n)) errors.push(`message contient « ${n} »`);
  }
  for (const n of c.realExclude ?? []) {
    if (has(real, n)) errors.push(`message contient « ${n} »`);
  }

  if (c.outcome !== 'draft') return errors;

  const firstName = ctx.senderName.split(' ')[0];
  if (!real.startsWith(firstName))
    errors.push(`message ne commence pas par « ${firstName} »`);

  const lang = ctx.targetLanguage;
  if (detectLang(real) !== lang)
    errors.push(`message pas en « ${lang} » (détecté ${detectLang(real)})`);
  if (INFORMAL[lang]?.test(real))
    errors.push(
      `tutoiement dans le message (${real.match(INFORMAL[lang])?.[2]})`,
    );
  if (FIRST_PERSON[lang]?.test(real)) {
    errors.push(
      `première personne dans le message (${real.match(FIRST_PERSON[lang])?.[2]})`,
    );
  }
  if (
    OBJECTIVE_START[ctx.senderLanguage] &&
    !OBJECTIVE_START[ctx.senderLanguage].test(obj)
  ) {
    errors.push(`objectif ne commence pas par « Vous/You »`);
  }
  return errors;
}

// ─── Exécution ───────────────────────────────────────────────────────────────

interface RunResult {
  id: string;
  category: string;
  run: number;
  errors: string[];
  result?: AiDraftResult;
  crash?: string;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

async function main() {
  const ai = new AiService(configuration());
  const cases = CASES.filter((c) => !ONLY || c.id.startsWith(ONLY));
  const jobs = cases.flatMap((c) =>
    Array.from({ length: RUNS }, (_, i) => ({ c, run: i + 1 })),
  );
  const results: RunResult[] = [];

  console.log(
    `Évaluation : ${cases.length} cas × ${RUNS} = ${jobs.length} appels\n`,
  );
  await pool(jobs, CONCURRENCY, async ({ c, run }) => {
    try {
      const result = await ai.processUserMessage({ ...BASE_CTX, ...c.ctx });
      results.push({
        id: c.id,
        category: c.category,
        run,
        errors: check(c, result),
        result,
      });
    } catch (e) {
      results.push({
        id: c.id,
        category: c.category,
        run,
        errors: ['appel en échec'],
        crash: (e as Error).message,
      });
    }
    process.stdout.write(results[results.length - 1].errors.length ? 'x' : '.');
  });

  // Résumé par catégorie
  console.log('\n');
  const categories = [...new Set(cases.map((c) => c.category))];
  for (const cat of categories) {
    const rs = results.filter((r) => r.category === cat);
    const ok = rs.filter((r) => !r.errors.length).length;
    console.log(
      `${ok === rs.length ? '✅' : '❌'} ${cat.padEnd(14)} ${ok}/${rs.length}`,
    );
  }

  // Détail des échecs
  const failures = results
    .filter((r) => r.errors.length)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (failures.length) {
    console.log('\nÉchecs :');
    for (const f of failures) {
      console.log(`\n• ${f.id} (essai ${f.run}) : ${f.errors.join(' ; ')}`);
      if (f.crash) console.log(`  erreur : ${f.crash}`);
      if (f.result) {
        console.log(`  objectif : ${f.result.objectiveMessage}`);
        console.log(`  message  : ${f.result.realMessage}`);
      }
    }
  }

  const ok = results.length - failures.length;
  const cost = results.reduce(
    (s, r) =>
      s +
      (r.result
        ? r.result.usage.inputTokens * 0.3 + r.result.usage.outputTokens * 2.5
        : 0),
    0,
  );
  console.log(
    `\nTotal : ${ok}/${results.length} conformes (${((100 * ok) / results.length).toFixed(1)} %) — coût ≈ ${(cost / 1e6).toFixed(3)} $`,
  );

  const dir = path.join(__dirname, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(
    file,
    JSON.stringify(
      results.sort((a, b) => a.id.localeCompare(b.id)),
      null,
      2,
    ),
  );
  console.log(`Rapport : ${path.relative(process.cwd(), file)}`);

  process.exit(failures.length ? 1 : 0);
}

void main();
