/**
 * Vérification ponctuelle du résumé de contexte (vrai Gemini, 1 appel).
 *   npx ts-node -r tsconfig-paths/register --transpile-only test/ai-eval/summary-check.ts
 */
import 'dotenv/config';
import configuration from '../../src/config/configuration';
import { AiService } from '../../src/modules/ai/ai.service';

const m = (type: string, content: string, i: number) =>
  ({ _id: `m${i}`, type, content, createdAt: new Date(2026, 9, 1 + i) }) as never;

async function main() {
  const ai = new AiService(configuration());
  const { summary, usage } = await ai.summarizeHistory({
    previousSummary:
      'Sarah et David organisent la garde de leur fille Léa. Accord de principe : une semaine sur deux, échange le dimanche à 18h.',
    messages: [
      m('text', "dis lui que l'échange de dimanche doit se faire chez ma mère à Lyon", 1),
      m('draft_snapshot', "Sarah souhaite vous informer que l'échange de dimanche se fera chez sa mère, à Lyon.", 2),
      m('real_message', "David vous fait savoir qu'il ne pourra pas avant 19h car il travaille jusqu'à 18h30.", 3),
      m('draft_snapshot', "Sarah accepte 19h et vous demande de confirmer l'adresse.", 4),
      m('real_message', "David confirme 19h et demande que Léa ait son cartable pour lundi.", 5),
      m('draft_snapshot', "Sarah vous rappelle que la pension de 250 € d'octobre n'a pas encore été versée.", 6),
      m('real_message', "David vous informe qu'il versera la pension le 10 novembre.", 7),
    ],
    senderName: 'Sarah',
    targetName: 'David',
    language: 'fr',
  });
  console.log('Résumé :\n' + summary);
  console.log(`\n${summary.length} caractères — ${usage.inputTokens} in / ${usage.outputTokens} out`);
  const facts = ['Lyon', '19', 'cartable', '250', '10 novembre'];
  const missing = facts.filter((f) => !summary.toLowerCase().includes(f.toLowerCase()));
  console.log(missing.length ? `Faits manquants : ${missing.join(', ')}` : 'Tous les faits clés sont présents.');
  process.exit(missing.length ? 1 : 0);
}
void main();
