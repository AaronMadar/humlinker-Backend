import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { canonicalJson } from './canonical-json';
import { ExportService } from './export.service';

/**
 * Export de l'historique : seuls les messages réellement échangés, dans l'ordre,
 * même ceux « effacés » à l'écran, avec une empreinte recalculable.
 */
describe('ExportService.exportHistory', () => {
  const at = (s: string) => new Date(`2026-03-0${s}Z`);

  const humlinker = {
    id: 'h-alice',
    senderId: 'alice',
    targetId: 'bob',
    title: 'Garde des enfants',
    targetContactName: 'Bob',
    createdAt: at('1T08:00:00'),
    // Effacé à l'écran après les deux premiers messages : doit rester exporté
    historyClearedAt: at('2T00:00:00'),
    senderUser: { firstName: 'Alice', lastName: 'Martin' },
    targetUser: { firstName: 'Bob', lastName: 'Durand' },
  };

  // Volontairement dans le désordre : l'ordre vient de la requête (orderBy createdAt)
  const rows = [
    { id: 'm1', type: 'draft_snapshot', content: 'aperçu 1', draftId: 'd1', createdAt: at('1T09:00:00') },
    { id: 'm2', type: 'real_message', content: 'Réponse de Bob', draftId: null, createdAt: at('1T10:00:00') },
    { id: 'm3', type: 'text', content: 'Secret : il m’énerve', draftId: null, createdAt: at('3T09:00:00') },
    { id: 'm4', type: 'draft_snapshot', content: 'Hola', draftId: 'd2', createdAt: at('3T10:00:00') },
  ];
  const drafts = [
    { id: 'd1', humhlinkerId: 'h-alice', realMessage: 'Bonjour Bob, peux-tu prendre les enfants samedi ?', senderPreview: 'Bonjour Bob, peux-tu prendre les enfants samedi ?' },
    { id: 'd2', humhlinkerId: 'h-alice', realMessage: '¿Puedes recogerlos a las 18 h?', senderPreview: 'Peux-tu les récupérer à 18 h ?' },
  ];

  let prisma: any;
  let service: ExportService;

  beforeEach(() => {
    prisma = {
      humlinker: { findUnique: jest.fn(async () => humlinker) },
      chatMessage: {
        findMany: jest.fn(async (args: any) =>
          rows
            .filter((r) => args.where.type.in.includes(r.type))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
        ),
      },
      draft: {
        findMany: jest.fn(async (args: any) =>
          drafts.filter((d) => args.where.id.in.includes(d.id)),
        ),
      },
    };
    service = new ExportService(prisma);
    jest.spyOn(service as any, 'now').mockReturnValue(new Date('2026-04-01T12:00:00Z'));
    jest.spyOn(service as any, 'newExportId').mockReturnValue('exp-1');
  });

  it('exporte les messages échangés dans l’ordre chronologique, sans les messages privés à l’IA', async () => {
    const res = await service.exportHistory('h-alice', 'alice');

    expect(res.messages.map((m) => [m.index, m.direction, m.text])).toEqual([
      [1, 'sent', 'Bonjour Bob, peux-tu prendre les enfants samedi ?'],
      [2, 'received', 'Réponse de Bob'],
      [3, 'sent', '¿Puedes recogerlos a las 18 h?'],
    ]);
    expect(JSON.stringify(res)).not.toContain('Secret');
    // La requête ne demande que les types échangés, triés par date
    const query = prisma.chatMessage.findMany.mock.calls[0][0];
    expect(query.where.type.in).toEqual(['draft_snapshot', 'real_message']);
    expect(query.orderBy[0]).toEqual({ createdAt: 'asc' });
  });

  it('inclut l’historique effacé à l’écran (historyClearedAt ignoré)', async () => {
    const res = await service.exportHistory('h-alice', 'alice');
    const query = prisma.chatMessage.findMany.mock.calls[0][0];
    expect(query.where.createdAt).toBeUndefined();
    expect(res.period.from).toBe('2026-03-01T09:00:00.000Z');
    expect(res.messageCount).toBe(3);
  });

  it('envoie le texte reçu par l’autre + l’aperçu seulement s’il diffère', async () => {
    const res = await service.exportHistory('h-alice', 'alice');
    expect(res.messages[0].senderPreview).toBeUndefined();
    expect(res.messages[2].senderPreview).toBe('Peux-tu les récupérer à 18 h ?');
  });

  it('participants : prénom + nom uniquement, jamais d’email ni de téléphone', async () => {
    const res = await service.exportHistory('h-alice', 'alice');
    expect(res.participants).toEqual({
      owner: { firstName: 'Alice', lastName: 'Martin' },
      other: { firstName: 'Bob', lastName: 'Durand' },
    });
    const select = prisma.humlinker.findUnique.mock.calls[0][0].include.targetUser.select;
    expect(Object.keys(select).sort()).toEqual(['firstName', 'lastName']);
  });

  it('refuse (403) le côté de l’autre personne, 404 si introuvable', async () => {
    await expect(service.exportHistory('h-alice', 'bob')).rejects.toBeInstanceOf(ForbiddenException);
    prisma.humlinker.findUnique.mockResolvedValueOnce(null);
    await expect(service.exportHistory('nope', 'alice')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('empreinte SHA-256 stable et recalculable depuis le JSON canonique', async () => {
    const a = await service.exportHistory('h-alice', 'alice');
    const b = await service.exportHistory('h-alice', 'alice');
    expect(a.integrity.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.integrity.hash).toBe(b.integrity.hash);
    expect(a.exportId).toBe('exp-1');

    // Vérification indépendante : on retire `integrity`, on canonicalise, on hache.
    const { integrity, ...content } = a;
    const expected = createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex');
    expect(integrity.hash).toBe(expected);
    // Re-parsé depuis le JSON (ordre des clés quelconque) → même empreinte
    expect(ExportService.computeHash(JSON.parse(JSON.stringify(a)))).toBe(expected);

    // Une seule lettre modifiée → empreinte différente
    const tampered = { ...content, messages: [{ ...content.messages[0], text: 'Bonjour Bob !' }, ...content.messages.slice(1)] };
    expect(ExportService.computeHash(tampered)).not.toBe(expected);
  });
});

describe('canonicalJson', () => {
  it('trie les clés et supprime les espaces', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 'é'], c: null } })).toBe('{"a":{"c":null,"d":[1,"é"]},"b":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
